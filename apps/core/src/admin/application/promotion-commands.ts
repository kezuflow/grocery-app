import { readPromotionRules } from "./promotion-audience";
import {
  activateProductSaleStatements,
  replaceProductSaleTargets,
  productSaleTargetsJsonSql,
} from "../../promotions/application/product-sales";
import type {
  AdminPromotionDetailRequest,
  AdminPromotionGrantPage,
  AdminPromotionGrantView,
  AdminPromotionSummary,
  ManageableBenefitType,
  RpcResult,
} from "@freshmarkets/contracts";
import { reservedPromotionCodes } from "@freshmarkets/contracts";
import {
  z,
  authenticatedRequestSchema,
  idempotencyKeySchema,
  identifierSchema,
  adminPromotionCreateBodySchema,
  adminPromotionUpdateBodySchema,
  adminPromotionStatusBodySchema,
  adminPromotionGrantBodySchema,
  adminPromotionSummarySchema,
  adminPromotionGrantViewSchema,
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolvePromotionAdministrationAccess,
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  type PromotionAdministrationDeps,
} from "./promotion-administration-access";
import {
  promotionCommandFailure as failure,
  requirePromotionEffect as required,
  promotionCommandReceipt,
  executePromotionCommand,
  type PromotionCommandIdentity,
} from "./promotion-command-recovery";

const meta = authenticatedRequestSchema.extend({ idempotencyKey: idempotencyKeySchema });
const createSchema = meta.extend(adminPromotionCreateBodySchema.shape);
const updateSchema = meta
  .extend(adminPromotionUpdateBodySchema.shape)
  .extend({ promotionId: identifierSchema });
const statusSchema = meta
  .extend(adminPromotionStatusBodySchema.shape)
  .extend({ promotionId: identifierSchema });
const grantSchema = meta
  .extend(adminPromotionGrantBodySchema.shape)
  .extend({ promotionId: identifierSchema });
function invalid(input: unknown) {
  const parsed = z.object({ requestId: identifierSchema }).safeParse(input);
  return failure(
    "VALIDATION_FAILED",
    "Check promotion fields, version and request key",
    parsed.success ? parsed.data.requestId : "unavailable",
  );
}
async function identity(
  scope: string,
  request: { idempotencyKey: string; requestId: string },
  body: unknown,
): Promise<PromotionCommandIdentity> {
  return {
    scope: `admin.promotions.${scope}`,
    key: request.idempotencyKey,
    requestId: request.requestId,
    hash: await requestHash(body),
  };
}
function receipt(
  db: D1Database,
  command: PromotionCommandIdentity,
  id: string,
  now: number,
  grant = false,
) {
  const result = grant
    ? `SELECT json_object('grantId',id,'promotionId',json_extract(parameters_json,'$.promotionId'),'customerId',customer_id,'benefitType',benefit_type,'maxRedemptions',max_redemptions,'status',status,'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',created_at/1000.0,'unixepoch')) FROM promotion_grant WHERE id=?`
    : `SELECT json_object('promotionId',id,'code',code,'name',name,'description',description,'status',status,'benefitType',benefit_type,'discountMinor',discount_minor,'percent',percent,'maximumDiscountMinor',maximum_discount_minor,'minimumMinor',minimum_minor,'startsAt',strftime('%Y-%m-%dT%H:%M:%fZ',starts_at/1000.0,'unixepoch'),'endsAt',strftime('%Y-%m-%dT%H:%M:%fZ',ends_at/1000.0,'unixepoch'),'globalUsageLimit',global_usage_limit,'perCustomerUsageLimit',per_customer_usage_limit,'automatic',json(CASE WHEN automatic=1 THEN 'true' ELSE 'false' END),'priority',priority,'version',version,'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',created_at/1000.0,'unixepoch'),'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',updated_at/1000.0,'unixepoch'),'productTargets',json(${productSaleTargetsJsonSql})) FROM promotion WHERE id=?`;
  return db
    .prepare(
      `UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(${result}),updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`,
    )
    .bind(id, now, command.scope, command.key, command.hash);
}
function validWindow(startsAt: string, endsAt: string | null | undefined) {
  return endsAt == null || Date.parse(endsAt) > Date.parse(startsAt);
}
function validBenefit(
  type: ManageableBenefitType,
  discountMinor: number | null | undefined,
  percent: number | null | undefined,
) {
  if (type === "DELIVERY_FEE_WAIVER") return discountMinor == null && percent == null;
  if (type === "ORDER_FIXED_DISCOUNT" || type === "DELIVERY_FIXED_DISCOUNT")
    return discountMinor != null && percent == null;
  return (
    (type === "ORDER_PERCENT_DISCOUNT" || type === "DELIVERY_PERCENT_DISCOUNT") &&
    percent != null &&
    discountMinor == null
  );
}

export async function createAdminPromotion(
  deps: PromotionAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminPromotionSummary>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  if (reservedPromotionCodes.some((code) => code === request.code))
    return failure("VALIDATION_FAILED", "Promotion code is reserved", request.requestId);
  if (
    !validWindow(request.startsAt, request.endsAt) ||
    !validBenefit(request.benefitType, request.discountMinor, request.percent)
  )
    return invalid(input);
  if (
    request.productTargets?.length &&
    (!request.benefitType.startsWith("ORDER_") ||
      request.maximumDiscountMinor != null ||
      new Set(request.productTargets.map((target) => `${target.locationId}:${target.skuId}`))
        .size !== request.productTargets.length)
  )
    return invalid(input);
  const { headers: _headers, requestId: _requestId, idempotencyKey: _key, ...body } = request;
  const command = await identity("create", request, body);
  const replay = await promotionCommandReceipt(deps.db, command, adminPromotionSummarySchema);
  if (replay) return replay;
  const id = crypto.randomUUID();
  const now = Date.now();
  const db = deps.db;
  return executePromotionCommand(
    db,
    command,
    access.value,
    "PROMOTION.CREATED",
    [
      db
        .prepare(
          `INSERT INTO promotion(id,code,name,description,status,benefit_type,discount_minor,percent,minimum_minor,starts_at,ends_at,global_usage_limit,per_customer_usage_limit,automatic,priority,maximum_discount_minor,version,created_at,updated_at) VALUES (?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .bind(
          id,
          request.code,
          request.name,
          request.description,
          request.benefitType,
          request.discountMinor ?? null,
          request.percent ?? null,
          request.minimumMinor,
          Date.parse(request.startsAt),
          request.endsAt ? Date.parse(request.endsAt) : null,
          request.globalUsageLimit ?? null,
          request.perCustomerUsageLimit ?? null,
          request.productTargets?.length || request.automatic ? 1 : 0,
          request.priority ?? 0,
          request.maximumDiscountMinor ?? null,
          now,
          now,
        ),
      required(db),
      ...replaceProductSaleTargets(db, id, request.productTargets ?? []),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: "PROMOTION.CREATED",
        resourceType: "promotion",
        resourceId: id,
        details: { code: request.code, benefitType: request.benefitType },
        correlationId: request.requestId,
        idempotencyKey: command.key,
        occurredAt: now,
      }),
      required(db),
    ],
    receipt(db, command, id, now),
    adminPromotionSummarySchema,
  );
}

type PromotionRow = {
  id: string;
  code: string;
  status: string;
  version: number;
  benefit_type: ManageableBenefitType;
  discount_minor: number | null;
  percent: number | null;
};
export async function updateAdminPromotion(
  deps: PromotionAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminPromotionSummary>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  if (!validWindow(request.startsAt, request.endsAt)) return invalid(input);
  const { headers: _headers, requestId: _requestId, idempotencyKey: _key, ...body } = request;
  const command = await identity("update", request, body);
  const replay = await promotionCommandReceipt(deps.db, command, adminPromotionSummarySchema);
  if (replay) return replay;
  const db = deps.db;
  const current = await db
    .prepare(
      "SELECT id,code,status,version,benefit_type,discount_minor,percent FROM promotion WHERE id=?",
    )
    .bind(request.promotionId)
    .first<PromotionRow>();
  if (!current) return failure("NOT_FOUND", "Promotion not found", request.requestId);
  if (current.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Promotion changed; reload before saving", request.requestId);
  if (current.status !== "DRAFT")
    return failure("VALIDATION_FAILED", "Only draft definitions can change", request.requestId);
  const discount = request.discountMinor ?? current.discount_minor;
  const percent = request.percent ?? current.percent;
  if (
    request.productTargets?.length &&
    (!current.benefit_type.startsWith("ORDER_") ||
      request.maximumDiscountMinor != null ||
      new Set(request.productTargets.map((target) => `${target.locationId}:${target.skuId}`))
        .size !== request.productTargets.length)
  )
    return invalid(input);
  if (
    !validBenefit(current.benefit_type, discount, percent) ||
    reservedPromotionCodes.some((code) => code === current.code)
  )
    return invalid(input);
  const now = Date.now();
  return executePromotionCommand(
    db,
    command,
    access.value,
    "PROMOTION.UPDATED",
    [
      db
        .prepare(
          "UPDATE promotion SET name=?,description=?,discount_minor=?,percent=?,minimum_minor=?,starts_at=?,ends_at=?,maximum_discount_minor=CASE WHEN ? THEN ? ELSE maximum_discount_minor END,global_usage_limit=CASE WHEN ? THEN ? ELSE global_usage_limit END,per_customer_usage_limit=CASE WHEN ? THEN ? ELSE per_customer_usage_limit END,automatic=COALESCE(?,automatic),updated_at=?,version=version+1 WHERE id=? AND version=? AND status='DRAFT'",
        )
        .bind(
          request.name,
          request.description,
          discount,
          percent,
          request.minimumMinor,
          Date.parse(request.startsAt),
          request.endsAt ? Date.parse(request.endsAt) : null,
          request.maximumDiscountMinor !== undefined ? 1 : 0,
          request.maximumDiscountMinor ?? null,
          request.globalUsageLimit !== undefined ? 1 : 0,
          request.globalUsageLimit ?? null,
          request.perCustomerUsageLimit !== undefined ? 1 : 0,
          request.perCustomerUsageLimit ?? null,
          request.productTargets?.length
            ? 1
            : request.automatic === undefined
              ? null
              : request.automatic
                ? 1
                : 0,
          now,
          current.id,
          request.expectedVersion,
        ),
      required(db),
      ...(request.productTargets === undefined
        ? []
        : replaceProductSaleTargets(db, current.id, request.productTargets)),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: "PROMOTION.UPDATED",
        resourceType: "promotion",
        resourceId: current.id,
        correlationId: request.requestId,
        idempotencyKey: command.key,
        occurredAt: now,
      }),
      required(db),
    ],
    receipt(db, command, current.id, now),
    adminPromotionSummarySchema,
  );
}
const transitions = {
  ACTIVATE: { from: ["DRAFT", "INACTIVE"], to: "ACTIVE" },
  DEACTIVATE: { from: ["ACTIVE"], to: "INACTIVE" },
  ARCHIVE: { from: ["DRAFT", "INACTIVE"], to: "ARCHIVED" },
};
export async function changeAdminPromotionStatus(
  deps: PromotionAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminPromotionSummary>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  const command = await identity("status", request, {
    promotionId: request.promotionId,
    action: request.action,
    reason: request.reason,
    expectedVersion: request.expectedVersion,
  });
  const replay = await promotionCommandReceipt(deps.db, command, adminPromotionSummarySchema);
  if (replay) return replay;
  const db = deps.db;
  const current = await db
    .prepare(
      "SELECT id,code,status,version,benefit_type,discount_minor,percent FROM promotion WHERE id=?",
    )
    .bind(request.promotionId)
    .first<PromotionRow>();
  if (!current) return failure("NOT_FOUND", "Promotion not found", request.requestId);
  if (current.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Promotion changed; reload before saving", request.requestId);
  if (reservedPromotionCodes.some((code) => code === current.code)) return invalid(input);
  const transition = transitions[request.action];
  if (!transition.from.includes(current.status))
    return failure(
      "ILLEGAL_TRANSITION",
      `${request.action} is not legal from ${current.status}`,
      request.requestId,
    );
  if (
    request.action === "ACTIVATE" &&
    !validBenefit(current.benefit_type, current.discount_minor, current.percent)
  )
    return invalid(input);
  const now = Date.now();
  if (
    request.action === "ACTIVATE" &&
    (await readPromotionRules(db, current.id)).unsupportedRuleCount > 0
  )
    return failure(
      "VALIDATION_FAILED",
      "Replace retired or invalid audience conditions before activating",
      request.requestId,
    );
  if (request.action === "ACTIVATE") {
    const overlap = await db
      .prepare(`SELECT 1 FROM promotion_product_target target JOIN promotion p ON p.id=target.promotion_id
      JOIN promotion_product_target other ON other.sku_id=target.sku_id AND other.location_id=target.location_id AND other.promotion_id!=p.id
      JOIN promotion competing ON competing.id=other.promotion_id
      WHERE p.id=? AND competing.status='ACTIVE' AND p.starts_at<COALESCE(competing.ends_at,9007199254740991)
        AND competing.starts_at<COALESCE(p.ends_at,9007199254740991) LIMIT 1`)
      .bind(current.id)
      .first();
    if (overlap)
      return failure(
        "VALIDATION_FAILED",
        "Another active sale covers the same selling option and location during these dates. Stop that sale or change this draft's dates or options.",
        request.requestId,
      );
  }
  const action = `PROMOTION.${request.action === "ACTIVATE" ? "ACTIVATED" : request.action === "DEACTIVATE" ? "DEACTIVATED" : "ARCHIVED"}`;
  return executePromotionCommand(
    db,
    command,
    access.value,
    action,
    [
      db
        .prepare(
          "UPDATE promotion SET status=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=?",
        )
        .bind(transition.to, now, current.id, request.expectedVersion, current.status),
      required(db),
      ...(request.action === "ACTIVATE" ? activateProductSaleStatements(db, current.id) : []),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action,
        resourceType: "promotion",
        resourceId: current.id,
        reason: request.reason,
        before: { status: current.status },
        after: { status: transition.to },
        correlationId: request.requestId,
        idempotencyKey: command.key,
        occurredAt: now,
      }),
      required(db),
    ],
    receipt(db, command, current.id, now),
    adminPromotionSummarySchema,
  );
}
export async function grantAdminPromotion(
  deps: PromotionAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminPromotionGrantView>> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  const command = await identity("grant", request, {
    promotionId: request.promotionId,
    customerId: request.customerId,
    maxRedemptions: request.maxRedemptions,
  });
  const replay = await promotionCommandReceipt(deps.db, command, adminPromotionGrantViewSchema);
  if (replay) return replay;
  const db = deps.db;
  const promotion = await db
    .prepare(
      "SELECT id,code,status,version,benefit_type,discount_minor,percent FROM promotion WHERE id=?",
    )
    .bind(request.promotionId)
    .first<PromotionRow>();
  if (!promotion) return failure("NOT_FOUND", "Promotion not found", request.requestId);
  if (
    promotion.status !== "ACTIVE" ||
    reservedPromotionCodes.some((code) => code === promotion.code)
  )
    return failure(
      "VALIDATION_FAILED",
      "Only active managed promotions can be granted",
      request.requestId,
    );
  const customer = await db
    .prepare(
      "SELECT c.id FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id WHERE c.id=? AND c.status='active' AND cp.status='active'",
    )
    .bind(request.customerId)
    .first();
  if (!customer)
    return failure("VALIDATION_FAILED", "An active customer is required", request.requestId);
  if (
    await db
      .prepare("SELECT id FROM promotion_grant WHERE benefit_code=? AND customer_id=?")
      .bind(promotion.code, request.customerId)
      .first()
  )
    return failure(
      "CONFLICT",
      "This promotion is already granted to the customer",
      request.requestId,
    );
  const id = crypto.randomUUID();
  const now = Date.now();
  return executePromotionCommand(
    db,
    command,
    access.value,
    "PROMOTION.GRANTED",
    [
      db
        .prepare(
          `INSERT INTO promotion_grant(id,benefit_code,benefit_type,max_redemptions,status,customer_id,parameters_json,created_at,updated_at) SELECT ?,p.code,p.benefit_type,?,'ACTIVE',?,?,?,? FROM promotion p WHERE p.id=? AND p.version=? AND p.status='ACTIVE' AND EXISTS(SELECT 1 FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id WHERE c.id=? AND c.status='active' AND cp.status='active') AND NOT EXISTS(SELECT 1 FROM promotion_grant WHERE benefit_code=p.code AND customer_id=?)`,
        )
        .bind(
          id,
          request.maxRedemptions,
          request.customerId,
          JSON.stringify({ promotionId: request.promotionId, customerId: request.customerId }),
          now,
          now,
          promotion.id,
          promotion.version,
          request.customerId,
          request.customerId,
        ),
      required(db),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: "PROMOTION.GRANTED",
        resourceType: "promotion_grant",
        resourceId: id,
        details: { promotionId: request.promotionId, customerId: request.customerId },
        correlationId: request.requestId,
        idempotencyKey: command.key,
        occurredAt: now,
      }),
      required(db),
    ],
    receipt(db, command, id, now, true),
    adminPromotionGrantViewSchema,
  );
}

/** Grants created for one promotion's code (never the INTRO_TRIAL authority). */
export async function listPromotionGrants(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionDetailRequest & { cursor?: string; limit?: number },
): Promise<RpcResult<AdminPromotionGrantPage>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.read");
  if (!access.ok) return access;

  const promotion = await deps.db
    .prepare("SELECT code FROM promotion WHERE id = ?")
    .bind(request.promotionId)
    .first<{ code: string }>();
  if (!promotion) return failure("NOT_FOUND", "Promotion not found", request.requestId);

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return failure(
      "VALIDATION_FAILED",
      "limit must be an integer between 1 and 100",
      request.requestId,
    );
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return failure("VALIDATION_FAILED", "cursor is malformed", request.requestId);
    }
  }
  const clauses = ["benefit_code = ?", "benefit_code != 'INTRO_TRIAL'"];
  const binds: unknown[] = [promotion.code];
  if (cursor) {
    clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const rows = await deps.db
    .prepare(
      `SELECT id, customer_id, benefit_type, max_redemptions, status, created_at
       FROM promotion_grant
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<{
      id: string;
      customer_id: string;
      benefit_type: ManageableBenefitType;
      max_redemptions: number;
      status: string;
      created_at: number;
    }>();
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items = pageRows.map((row) => ({
    grantId: row.id,
    promotionId: request.promotionId,
    customerId: row.customer_id,
    benefitType: row.benefit_type,
    maxRedemptions: row.max_redemptions,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  }));
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}
