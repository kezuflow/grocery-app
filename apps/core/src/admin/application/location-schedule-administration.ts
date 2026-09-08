import type {
  AuthenticatedRequest,
  AdminLocationScheduleView,
  SaveAdminLocationScheduleRequest,
  RpcResult,
  AppErrorCode,
} from "@freshmarkets/contracts";
import {
  z,
  identifierSchema,
  idempotencyKeySchema,
  locationOperatingScheduleSchema,
  adminLocationScheduleViewSchema,
} from "@freshmarkets/validation";
import { authenticatedRequestSchema } from "../../validation";
import {
  resolveLocationAdministrationAccess as access,
  type LocationAdministrationDeps,
} from "./location-administration";
import { validateOperatingSchedule, operatingInterval } from "../../geography/operating-schedule";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";

const readSchema = authenticatedRequestSchema.extend({ locationId: identifierSchema });
const saveSchema = readSchema.extend({
  expectedVersion: z.number().int().safe().positive(),
  schedule: locationOperatingScheduleSchema,
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});
const failure = (code: AppErrorCode, message: string, requestId: string) => ({
  ok: false as const,
  error: { code, message, requestId },
});
const required = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
async function load(db: D1Database, locationId: string) {
  return db
    .prepare(`SELECT l.id locationId,l.name locationName,l.market_id marketId,l.version,m.timezone,s.definition_json definitionJson
    FROM fulfillment_location l JOIN market m ON m.id=l.market_id LEFT JOIN location_operating_schedule s ON s.location_id=l.id WHERE l.id=?`)
    .bind(locationId)
    .first<{
      locationId: string;
      locationName: string;
      marketId: string;
      version: number;
      timezone: string;
      definitionJson: string | null;
    }>();
}
export async function getAdminLocationSchedule(
  deps: LocationAdministrationDeps,
  input: AuthenticatedRequest & { locationId: string },
): Promise<RpcResult<AdminLocationScheduleView>> {
  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Select a location", input.requestId);
  const allowed = await access(deps, parsed.data, "locations.read");
  if (!allowed.ok) return allowed;
  const row = await load(deps.db, parsed.data.locationId);
  if (!row) return failure("NOT_FOUND", "Location not found", input.requestId);
  const manage = await access(deps, parsed.data, "locations.manage");
  return {
    ok: true,
    requestId: input.requestId,
    value: adminLocationScheduleViewSchema.parse({
      ...row,
      schedule: row.definitionJson ? JSON.parse(row.definitionJson) : null,
      canManage: manage.ok,
    }),
  };
}
export async function saveAdminLocationSchedule(
  deps: LocationAdministrationDeps,
  input: SaveAdminLocationScheduleRequest,
): Promise<RpcResult<AdminLocationScheduleView>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Check operating hours, closures, version and reason",
      input.requestId,
    );
  const request = parsed.data;
  const allowed = await access(deps, request, "locations.manage");
  if (!allowed.ok) return allowed;
  const { headers: _headers, requestId: _requestId, idempotencyKey, ...intent } = request;
  const hash = await requestHash({ ...intent, actor: allowed.authUserId }),
    scope = "admin.location-schedule.save";
  async function replay(): Promise<RpcResult<AdminLocationScheduleView> | null> {
    const saved = await deps.db
      .prepare(
        "SELECT request_hash,status,result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
      )
      .bind(scope, idempotencyKey)
      .first<{ request_hash: string; status: string; result_reference: string | null }>();
    if (!saved) return null;
    if (saved.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Key belongs to another schedule request",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED" || !saved.result_reference)
      return failure("CONFLICT", "Schedule request needs recovery", request.requestId);
    const result = adminLocationScheduleViewSchema.safeParse(JSON.parse(saved.result_reference));
    return result.success
      ? { ok: true, requestId: request.requestId, value: result.data }
      : failure("CONFLICT", "Saved schedule result needs recovery", request.requestId);
  }
  const prior = await replay();
  if (prior) return prior;
  const row = await load(deps.db, request.locationId);
  if (!row) return failure("NOT_FOUND", "Location not found", request.requestId);
  if (row.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Location changed; refresh and review", request.requestId);
  const invalid = validateOperatingSchedule(request.schedule);
  if (invalid) return failure("VALIDATION_FAILED", invalid, request.requestId);
  const now = Date.now();
  try {
    operatingInterval(request.schedule, row.timezone, now);
  } catch {
    return failure(
      "CONFIGURATION_ERROR",
      "The market timezone needs correction",
      request.requestId,
    );
  }
  const next: AdminLocationScheduleView = {
    locationId: row.locationId,
    locationName: row.locationName,
    timezone: row.timezone,
    version: row.version + 1,
    schedule: request.schedule,
    canManage: true,
  };
  try {
    await deps.db.batch([
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global'
        JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
        WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='locations.manage')
        OR NOT EXISTS (SELECT 1 FROM fulfillment_location l JOIN market m ON m.id=l.market_id WHERE l.id=? AND l.name=? AND m.id=? AND m.timezone=?)`)
        .bind(
          allowed.staffId,
          allowed.authUserId,
          row.locationId,
          row.locationName,
          row.marketId,
          row.timezone,
        ),
      deps.db
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','location_schedule',?,?)",
        )
        .bind(scope, idempotencyKey, hash, now, now),
      required(deps.db),
      deps.db
        .prepare(
          "UPDATE fulfillment_location SET version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .bind(now, row.locationId, request.expectedVersion),
      required(deps.db),
      deps.db
        .prepare(`INSERT INTO location_operating_schedule(location_id,timezone,definition_json,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(location_id) DO UPDATE SET timezone=excluded.timezone,definition_json=excluded.definition_json,updated_at=excluded.updated_at`)
        .bind(row.locationId, row.timezone, JSON.stringify(request.schedule), now),
      required(deps.db),
      deps.db
        .prepare(
          "INSERT INTO geography_configuration(market_id,version,updated_at) VALUES (?,2,?) ON CONFLICT(market_id) DO UPDATE SET version=version+1,updated_at=excluded.updated_at",
        )
        .bind(row.marketId, now),
      required(deps.db),
      deps.db
        .prepare(`UPDATE checkout_quote SET status='SUPERSEDED',version=version+1,updated_at=? WHERE status='ACTIVE'
        AND json_extract(cycle_snapshot_json,'$.locationId') IN (SELECT id FROM fulfillment_location WHERE market_id=?)
        AND NOT EXISTS (SELECT 1 FROM payment_intent p WHERE p.subject_type='checkout_quote' AND p.subject_id=checkout_quote.id)`)
        .bind(now, row.marketId),
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM checkout_quote q WHERE q.status='ACTIVE'
        AND json_extract(q.cycle_snapshot_json,'$.locationId') IN (SELECT id FROM fulfillment_location WHERE market_id=?)
        AND NOT EXISTS (SELECT 1 FROM payment_intent p WHERE p.subject_type='checkout_quote' AND p.subject_id=q.id))`)
        .bind(row.marketId),
      auditEventStatement(deps.db, {
        actorUserId: allowed.authUserId,
        action: "LOCATION.SCHEDULE_SAVED",
        resourceType: "fulfillment_location",
        resourceId: row.locationId,
        marketId: row.marketId,
        locationId: row.locationId,
        reason: request.reason,
        idempotencyKey,
        correlationId: request.requestId,
        occurredAt: now,
        before: { version: row.version },
        after: {
          version: next.version,
          weeklyIntervals: request.schedule.weekly.length,
          closures: request.schedule.closures.length,
        },
      }),
      required(deps.db),
      deps.db
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(next), now, scope, idempotencyKey),
      required(deps.db),
    ]);
  } catch {
    return (
      (await replay()) ??
      failure("CONFLICT", "Location or access changed; refresh and review", request.requestId)
    );
  }
  return { ok: true, requestId: request.requestId, value: next };
}
