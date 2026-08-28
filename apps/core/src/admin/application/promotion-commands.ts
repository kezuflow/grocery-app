import type {
  AdminPromotionCreateRequest,
  AdminPromotionDetailRequest,
  AdminPromotionGrantPage,
  AdminPromotionGrantRequest,
  AdminPromotionGrantView,
  AdminPromotionStatusChangeRequest,
  AdminPromotionSummary,
  AdminPromotionUpdateRequest,
  AppErrorCode,
  ManageableBenefitType,
  RpcResult,
} from "@freshmarkets/contracts";
import { manageableBenefitTypes } from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement, appendAuditEvent } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import { readPromotionDetail } from "./promotion-reads";
import { resolvePromotionAdministrationAccess, boundListLimit, decodeStaffCursor, encodeStaffCursor, type PromotionAdministrationDeps } from "./promotion-administration-access";

const CREATE_SCOPE = "admin.promotions.create";
const UPDATE_SCOPE = "admin.promotions.update";
const STATUS_SCOPE = "admin.promotions.status";
const GRANT_SCOPE = "admin.promotions.grant";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function idempotencyComplete(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  now: number,
): D1PreparedStatement {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, now, scope, key);
}

function idempotencyFailed(database: D1Database, scope: string, key: string): Promise<unknown> {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

/** Create a DRAFT promotion definition over the closed order-benefit set. */
export async function createAdminPromotion(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionCreateRequest,
): Promise<RpcResult<AdminPromotionSummary>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;

  const code = request.code.trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
    return failure("VALIDATION_FAILED", "code must be UPPER_SNAKE_CASE", request.requestId);
  }
  const name = request.name.trim();
  if (name === "") {
    return failure("VALIDATION_FAILED", "A name is required", request.requestId);
  }
  if (!manageableBenefitTypes.includes(request.benefitType)) {
    return failure("VALIDATION_FAILED", "benefitType must be an order benefit", request.requestId);
  }
  const startsAt = Date.parse(request.startsAt);
  if (Number.isNaN(startsAt)) {
    return failure("VALIDATION_FAILED", "startsAt must be an ISO 8601 instant", request.requestId);
  }
  const endsAt = request.endsAt ? Date.parse(request.endsAt) : null;
  if (request.endsAt && (endsAt === null || Number.isNaN(endsAt))) {
    return failure("VALIDATION_FAILED", "endsAt must be an ISO 8601 instant", request.requestId);
  }
  if (endsAt !== null && endsAt < startsAt) {
    return failure("VALIDATION_FAILED", "endsAt must not precede startsAt", request.requestId);
  }
  let discountMinor: number | null = null;
  let percent: number | null = null;
  if (request.benefitType === "ORDER_FIXED_DISCOUNT") {
    if (!Number.isInteger(request.discountMinor) || (request.discountMinor ?? 0) <= 0) {
      return failure("VALIDATION_FAILED", "A positive discountMinor is required", request.requestId);
    }
    discountMinor = request.discountMinor ?? null;
  } else {
    if (!Number.isInteger(request.percent) || (request.percent ?? 0) < 1 || (request.percent ?? 0) > 100) {
      return failure("VALIDATION_FAILED", "percent must be an integer 1-100", request.requestId);
    }
    percent = request.percent ?? null;
  }
  if (!Number.isInteger(request.minimumMinor) || request.minimumMinor < 0) {
    return failure("VALIDATION_FAILED", "minimumMinor must be a non-negative integer", request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, CREATE_SCOPE, request.idempotencyKey, {
    code,
    name,
    description: request.description.trim(),
    benefitType: request.benefitType,
    discountMinor,
    percent,
    minimumMinor: request.minimumMinor,
    startsAt: request.startsAt,
    endsAt: request.endsAt ?? null,
    globalUsageLimit: request.globalUsageLimit ?? null,
    perCustomerUsageLimit: request.perCustomerUsageLimit ?? null,
    automatic: request.automatic === true,
    priority: request.priority ?? 0,
  });
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request", request.requestId);
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      return readPromotionDetail(deps, claim.existing.resultReference, request.requestId);
    }
    return failure("CONFLICT", "The create command is still processing", request.requestId);
  }

  const promotionId = crypto.randomUUID();
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          `INSERT INTO promotion (id, code, name, description, status, benefit_type, discount_minor, percent,
                                  minimum_minor, starts_at, ends_at, global_usage_limit, per_customer_usage_limit,
                                  automatic, priority, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          promotionId,
          code,
          name,
          request.description.trim(),
          request.benefitType,
          discountMinor,
          percent,
          request.minimumMinor,
          startsAt,
          endsAt,
          request.globalUsageLimit ?? null,
          request.perCustomerUsageLimit ?? null,
          request.automatic === true ? 1 : 0,
          request.priority ?? 0,
          now,
          now,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "PROMOTION.CREATED",
        resourceType: "promotion",
        resourceId: promotionId,
        details: { code, benefitType: request.benefitType },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, CREATE_SCOPE, request.idempotencyKey, promotionId, now),
    ]);
  } catch (error) {
    log("error", "admin.promotions.create_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, CREATE_SCOPE, request.idempotencyKey);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      return failure("CONFLICT", "A promotion with this code already exists", request.requestId);
    }
    return failure("CONFLICT", "The promotion could not be created", request.requestId);
  }

  return readPromotionDetail(deps, promotionId, request.requestId);
}

type PromotionRow = {
  id: string;
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
  version: number;
};

/** Update a DRAFT definition; archived rows and lifecycle fields are frozen. */
export async function updateAdminPromotion(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionUpdateRequest,
): Promise<RpcResult<AdminPromotionSummary>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;

  const current = await deps.db
    .prepare("SELECT id, status, version FROM promotion WHERE id = ?")
    .bind(request.promotionId)
    .first<PromotionRow>();
  if (!current) return failure("NOT_FOUND", "Promotion not found", request.requestId);
  if (current.status === "ARCHIVED") {
    return failure("VALIDATION_FAILED", "Archived promotions cannot be updated", request.requestId);
  }
  if (current.status !== "DRAFT") {
    return failure(
      "VALIDATION_FAILED",
      "Only DRAFT definitions can change; deactivate first to define a new version",
      request.requestId,
    );
  }
  const name = request.name.trim();
  if (name === "") {
    return failure("VALIDATION_FAILED", "A name is required", request.requestId);
  }
  const startsAt = Date.parse(request.startsAt);
  if (Number.isNaN(startsAt)) {
    return failure("VALIDATION_FAILED", "startsAt must be an ISO 8601 instant", request.requestId);
  }
  const endsAt = request.endsAt ? Date.parse(request.endsAt) : null;
  if (request.endsAt && (endsAt === null || Number.isNaN(endsAt))) {
    return failure("VALIDATION_FAILED", "endsAt must be an ISO 8601 instant", request.requestId);
  }
  if (endsAt !== null && endsAt < startsAt) {
    return failure("VALIDATION_FAILED", "endsAt must not precede startsAt", request.requestId);
  }
  if (!Number.isInteger(request.minimumMinor) || request.minimumMinor < 0) {
    return failure("VALIDATION_FAILED", "minimumMinor must be a non-negative integer", request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, UPDATE_SCOPE, request.idempotencyKey, {
    promotionId: request.promotionId,
    name,
    description: request.description.trim(),
    discountMinor: request.discountMinor ?? null,
    percent: request.percent ?? null,
    minimumMinor: request.minimumMinor,
    startsAt: request.startsAt,
    endsAt: request.endsAt ?? null,
    expectedVersion: request.expectedVersion,
  });
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request", request.requestId);
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readPromotionDetail(deps, request.promotionId, request.requestId);
    }
    return failure("CONFLICT", "The update command is still processing", request.requestId);
  }

  const updated = await deps.db
    .prepare(
      "UPDATE promotion SET name=?, description=?, discount_minor=COALESCE(?, discount_minor), percent=COALESCE(?, percent), minimum_minor=?, starts_at=?, ends_at=?, updated_at=?, version=version+1 WHERE id=? AND version=?",
    )
    .bind(
      name,
      request.description.trim(),
      request.discountMinor ?? null,
      request.percent ?? null,
      request.minimumMinor,
      startsAt,
      endsAt,
      now,
      request.promotionId,
      request.expectedVersion,
    )
    .run();
  if ((updated.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, UPDATE_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Promotion changed; refresh before retrying", request.requestId);
  }
  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "PROMOTION.UPDATED",
      resourceType: "promotion",
      resourceId: request.promotionId,
      correlationId: request.requestId,
      occurredAt: now,
    }),
    idempotencyComplete(deps.db, UPDATE_SCOPE, request.idempotencyKey, request.promotionId, now),
  ]);
  return readPromotionDetail(deps, request.promotionId, request.requestId);
}

const STATUS_TRANSITIONS: Record<"ACTIVATE" | "DEACTIVATE" | "ARCHIVE", { from: string[]; to: string }> = {
  ACTIVATE: { from: ["DRAFT", "INACTIVE"], to: "ACTIVE" },
  DEACTIVATE: { from: ["ACTIVE"], to: "INACTIVE" },
  ARCHIVE: { from: ["DRAFT", "INACTIVE"], to: "ARCHIVED" },
};

/** Activate, deactivate, or archive a promotion through the legal lifecycle. */
export async function changeAdminPromotionStatus(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionStatusChangeRequest,
): Promise<RpcResult<AdminPromotionSummary>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A reason is required", request.requestId);
  }

  const current = await deps.db
    .prepare("SELECT id, status, version FROM promotion WHERE id = ?")
    .bind(request.promotionId)
    .first<PromotionRow>();
  if (!current) return failure("NOT_FOUND", "Promotion not found", request.requestId);
  const transition = STATUS_TRANSITIONS[request.action];
  if (!transition.from.includes(current.status)) {
    return failure(
      "ILLEGAL_TRANSITION",
      `${request.action} is not legal from ${current.status}`,
      request.requestId,
    );
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, STATUS_SCOPE, request.idempotencyKey, {
    promotionId: request.promotionId,
    action: request.action,
    reason,
    expectedVersion: request.expectedVersion,
  });
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request", request.requestId);
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readPromotionDetail(deps, request.promotionId, request.requestId);
    }
    return failure("CONFLICT", "The status command is still processing", request.requestId);
  }

  const guard = "EXISTS (SELECT 1 FROM promotion WHERE id = ? AND version = ?)";
  const guardBinds = [request.promotionId, request.expectedVersion];
  const auditAction =
    request.action === "ACTIVATE"
      ? "PROMOTION.ACTIVATED"
      : request.action === "DEACTIVATE"
        ? "PROMOTION.DEACTIVATED"
        : "PROMOTION.ARCHIVED";
  try {
    await deps.db.batch([
      auditEventStatement(
        deps.db,
        {
          actorUserId: access.value.authUserId,
          action: auditAction,
          resourceType: "promotion",
          resourceId: request.promotionId,
          reason,
          before: { status: current.status },
          after: { status: transition.to },
          correlationId: request.requestId,
          occurredAt: now,
        },
        { clause: guard, binds: guardBinds },
      ),
      deps.db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
           WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${guard}`,
        )
        .bind(request.promotionId, now, STATUS_SCOPE, request.idempotencyKey, ...guardBinds),
      deps.db
        .prepare("UPDATE promotion SET status=?, updated_at=?, version=version+1 WHERE id=? AND status=? AND version=?")
        .bind(transition.to, now, request.promotionId, current.status, request.expectedVersion),
    ]);
  } catch (error) {
    log("error", "admin.promotions.status_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, STATUS_SCOPE, request.idempotencyKey);
    return failure("CONFLICT", "The status change could not be applied", request.requestId);
  }

  const after = await deps.db
    .prepare("SELECT version FROM promotion WHERE id = ?")
    .bind(request.promotionId)
    .first<{ version: number }>();
  if (after?.version !== request.expectedVersion + 1) {
    return failure("STALE_VERSION", "Promotion changed; refresh before retrying", request.requestId);
  }
  return readPromotionDetail(deps, request.promotionId, request.requestId);
}

/** Grant an ACTIVE promotion to one customer through the canonical grant table. */
export async function grantAdminPromotion(
  deps: PromotionAdministrationDeps,
  request: AdminPromotionGrantRequest,
): Promise<RpcResult<AdminPromotionGrantView>> {
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  if (!Number.isInteger(request.maxRedemptions) || request.maxRedemptions < 1) {
    return failure("VALIDATION_FAILED", "maxRedemptions must be a positive integer", request.requestId);
  }

  const promotion = await deps.db
    .prepare("SELECT id, code, status, benefit_type FROM promotion WHERE id = ?")
    .bind(request.promotionId)
    .first<{ id: string; code: string; status: string; benefit_type: ManageableBenefitType }>();
  if (!promotion) return failure("NOT_FOUND", "Promotion not found", request.requestId);
  if (promotion.status !== "ACTIVE") {
    return failure("VALIDATION_FAILED", "Only ACTIVE promotions can be granted", request.requestId);
  }
  const customer = await deps.db
    .prepare("SELECT id FROM customer WHERE id = ?")
    .bind(request.customerId)
    .first<{ id: string }>();
  if (!customer) return failure("VALIDATION_FAILED", "Unknown customer", request.requestId);

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, GRANT_SCOPE, request.idempotencyKey, {
    promotionId: request.promotionId,
    customerId: request.customerId,
    maxRedemptions: request.maxRedemptions,
  });
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request", request.requestId);
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      const replay = await deps.db
        .prepare(
          "SELECT id, customer_id, benefit_type, max_redemptions, status, created_at FROM promotion_grant WHERE id = ?",
        )
        .bind(claim.existing.resultReference)
        .first<{ id: string; customer_id: string; benefit_type: ManageableBenefitType; max_redemptions: number; status: string; created_at: number }>();
      if (replay) {
        return {
          ok: true,
          value: {
            grantId: replay.id,
            promotionId: request.promotionId,
            customerId: replay.customer_id,
            benefitType: replay.benefit_type,
            maxRedemptions: replay.max_redemptions,
            status: replay.status,
            createdAt: new Date(replay.created_at).toISOString(),
          },
          requestId: request.requestId,
        };
      }
    }
    return failure("CONFLICT", "The grant command is still processing", request.requestId);
  }

  const grantId = crypto.randomUUID();
  const inserted = await deps.db
    .prepare(
      "INSERT INTO promotion_grant (id, benefit_code, benefit_type, max_redemptions, status, customer_id, parameters_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)",
    )
    .bind(
      grantId,
      promotion.code,
      promotion.benefit_type,
      request.maxRedemptions,
      request.customerId,
      JSON.stringify({ promotionId: request.promotionId, customerId: request.customerId }),
      now,
      now,
    )
    .run();
  if ((inserted.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, GRANT_SCOPE, request.idempotencyKey);
    return failure("CONFLICT", "The grant could not be created", request.requestId);
  }
  const appended = await appendAuditEvent(deps.db, {
    actorUserId: access.value.authUserId,
    action: "PROMOTION.GRANTED",
    resourceType: "promotion_grant",
    resourceId: grantId,
    details: { promotionId: request.promotionId, customerId: request.customerId },
    correlationId: request.requestId,
    occurredAt: now,
  });
  if (!appended) {
    await idempotencyFailed(deps.db, GRANT_SCOPE, request.idempotencyKey);
    return failure("CONFLICT", "The grant could not be recorded", request.requestId);
  }
  await deps.db
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(grantId, now, GRANT_SCOPE, request.idempotencyKey)
    .run();

  return {
    ok: true,
    value: {
      grantId,
      promotionId: request.promotionId,
      customerId: request.customerId,
      benefitType: promotion.benefit_type,
      maxRedemptions: request.maxRedemptions,
      status: "ACTIVE",
      createdAt: new Date(now).toISOString(),
    },
    requestId: request.requestId,
  };
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
    return failure("VALIDATION_FAILED", "limit must be an integer between 1 and 100", request.requestId);
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
    .all<{ id: string; customer_id: string; benefit_type: ManageableBenefitType; max_redemptions: number; status: string; created_at: number }>();
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
