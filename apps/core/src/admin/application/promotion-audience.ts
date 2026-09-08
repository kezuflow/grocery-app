import type {
  AdminPromotionAudience,
  AdminPromotionAudienceView,
  AdminPromotionRule,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  authenticatedRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  adminPromotionAudienceBodySchema,
  adminPromotionAudienceSchema,
  promotionRuleSchema,
  z,
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolvePromotionAdministrationAccess,
  type PromotionAdministrationDeps,
} from "./promotion-administration-access";
import { resolveCustomerAdministrationAccess } from "./customer-administration-access";
import {
  executePromotionCommand,
  promotionCommandReceipt,
  promotionCommandFailure as failure,
  requirePromotionEffect as required,
} from "./promotion-command-recovery";

const readSchema = authenticatedRequestSchema.extend({
  promotionId: identifierSchema,
  segmentQuery: z.string().trim().max(200).optional(),
});
const writeSchema = authenticatedRequestSchema
  .extend(adminPromotionAudienceBodySchema.shape)
  .extend({ promotionId: identifierSchema, idempotencyKey: idempotencyKeySchema });
function invalid(input: unknown) {
  const requestId =
    typeof input === "object" &&
    input !== null &&
    "requestId" in input &&
    typeof input.requestId === "string"
      ? input.requestId
      : "unknown";
  return failure("VALIDATION_FAILED", "Check the campaign audience conditions", requestId);
}
export async function readPromotionRules(db: D1Database, promotionId: string) {
  const stored = await db
    .prepare(
      "SELECT rule_type,parameters_json FROM promotion_rule WHERE promotion_id=? ORDER BY sort_order,id",
    )
    .bind(promotionId)
    .all<{ rule_type: string; parameters_json: string }>();
  const rules: AdminPromotionRule[] = [];
  let unsupportedRuleCount = 0;
  for (const row of stored.results) {
    try {
      const parsed = promotionRuleSchema.safeParse({
        type: row.rule_type,
        parameters: JSON.parse(row.parameters_json),
      });
      if (parsed.success) rules.push(parsed.data);
      else unsupportedRuleCount++;
    } catch {
      unsupportedRuleCount++;
    }
  }
  return { rules, unsupportedRuleCount };
}
export async function getAdminPromotionAudience(
  deps: PromotionAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminPromotionAudienceView>> {
  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.read");
  if (!access.ok) return access;
  const promotion = await deps.db
    .prepare("SELECT version FROM promotion WHERE id=?")
    .bind(request.promotionId)
    .first<{ version: number }>();
  if (!promotion) return failure("NOT_FOUND", "Promotion not found", request.requestId);
  const audience = await readPromotionRules(deps.db, request.promotionId);
  const segments = await deps.db
    .prepare(
      "SELECT id AS segmentId,name FROM customer_segment WHERE status='ACTIVE' AND instr(lower(name),lower(?))>0 ORDER BY name,id LIMIT 101",
    )
    .bind(request.segmentQuery ?? "")
    .all<{ segmentId: string; name: string }>();
  const customers: { customerId: string; label: string }[] = [];
  const customerIds = [
    ...new Set(
      audience.rules.flatMap((rule) =>
        rule.type === "SPECIFIC_CUSTOMERS" ? rule.parameters.customerIds : [],
      ),
    ),
  ];
  if (customerIds.length) {
    const readable = await resolveCustomerAdministrationAccess(deps, request, "customers.read");
    if (readable.ok) {
      const rows = await deps.db
        .prepare(
          "SELECT c.id AS customerId,u.email,c.phone FROM customer c JOIN user u ON u.id=c.auth_user_id WHERE c.id IN (SELECT value FROM json_each(?))",
        )
        .bind(JSON.stringify(customerIds))
        .all<{ customerId: string; email: string; phone: string | null }>();
      customers.push(
        ...rows.results.map((row) => ({
          customerId: row.customerId,
          label: row.phone ? `${row.email} (${row.phone})` : row.email,
        })),
      );
    }
  }
  return {
    ok: true,
    value: {
      promotionId: request.promotionId,
      version: promotion.version,
      ...audience,
      segments: segments.results.slice(0, 100),
      moreSegments: segments.results.length > 100,
      customers,
    },
    requestId: request.requestId,
  };
}
export async function setAdminPromotionAudience(
  deps: PromotionAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminPromotionAudience>> {
  const parsed = writeSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  const command = {
    scope: "admin.promotions.audience",
    key: request.idempotencyKey,
    requestId: request.requestId,
    hash: await requestHash({
      promotionId: request.promotionId,
      rules: request.rules,
      expectedVersion: request.expectedVersion,
    }),
  };
  const replay = await promotionCommandReceipt(deps.db, command, adminPromotionAudienceSchema);
  if (replay) return replay;
  const db = deps.db;
  const current = await db
    .prepare("SELECT version,status FROM promotion WHERE id=?")
    .bind(request.promotionId)
    .first<{ version: number; status: string }>();
  if (!current) return failure("NOT_FOUND", "Promotion not found", request.requestId);
  if (current.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Campaign changed; reload before saving", request.requestId);
  if (current.status !== "DRAFT")
    return failure("ILLEGAL_TRANSITION", "Only draft audiences can change", request.requestId);
  const now = Date.now();
  const effects: D1PreparedStatement[] = [
    db
      .prepare(
        "UPDATE promotion SET version=version+1,updated_at=? WHERE id=? AND version=? AND status='DRAFT'",
      )
      .bind(now, request.promotionId, request.expectedVersion),
    required(db),
    db.prepare("DELETE FROM promotion_rule WHERE promotion_id=?").bind(request.promotionId),
    db
      .prepare(
        "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS(SELECT 1 FROM promotion_rule WHERE promotion_id=?)",
      )
      .bind(request.promotionId),
  ];
  for (const [index, rule] of request.rules.entries()) {
    if (rule.type === "SPECIFIC_CUSTOMERS")
      effects.push(
        db
          .prepare(
            "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS(SELECT 1 FROM json_each(?) target WHERE NOT EXISTS(SELECT 1 FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id WHERE c.id=target.value AND c.status='active' AND cp.status='active'))",
          )
          .bind(JSON.stringify(rule.parameters.customerIds)),
      );
    if (rule.type === "CUSTOMER_SEGMENT")
      effects.push(
        db
          .prepare(
            "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS(SELECT 1 FROM customer_segment WHERE id=? AND status='ACTIVE')",
          )
          .bind(rule.parameters.segmentId),
      );
    effects.push(
      db
        .prepare(
          "INSERT INTO promotion_rule(id,promotion_id,rule_type,parameters_json,sort_order,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          request.promotionId,
          rule.type,
          JSON.stringify(rule.parameters),
          index,
          now,
          now,
        ),
      required(db),
    );
  }
  effects.push(
    auditEventStatement(db, {
      actorUserId: access.value.authUserId,
      action: "PROMOTION.AUDIENCE_UPDATED",
      resourceType: "promotion",
      resourceId: request.promotionId,
      details: { conditionCount: request.rules.length },
      correlationId: request.requestId,
      idempotencyKey: command.key,
      occurredAt: now,
    }),
    required(db),
  );
  const receipt = db
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(SELECT json_object('promotionId',id,'version',version,'rules',json(?)) FROM promotion WHERE id=?),updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
    .bind(
      JSON.stringify(request.rules),
      request.promotionId,
      now,
      command.scope,
      command.key,
      command.hash,
    );
  return executePromotionCommand(
    db,
    command,
    access.value,
    "PROMOTION.AUDIENCE_UPDATED",
    effects,
    receipt,
    adminPromotionAudienceSchema,
  );
}
