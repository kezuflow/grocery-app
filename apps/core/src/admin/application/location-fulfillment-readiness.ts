import type {
  AuthenticatedRequest,
  AdminLocationFulfillmentView,
  ConfigureAdminLocationFulfillmentRequest,
  RpcResult,
  AppErrorCode,
} from "@freshmarkets/contracts";
import {
  z,
  identifierSchema,
  idempotencyKeySchema,
  locationFulfillmentSettingsSchema,
  adminLocationFulfillmentViewSchema,
} from "@freshmarkets/validation";
import { authenticatedRequestSchema } from "../../validation";
import {
  resolveLocationAdministrationAccess as access,
  type LocationAdministrationDeps,
} from "./location-administration";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
const readSchema = authenticatedRequestSchema.extend({ locationId: identifierSchema });
const commandSchema = readSchema.extend({
  ...locationFulfillmentSettingsSchema.shape,
  expectedVersion: z.number().int().safe().positive(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});
const fail = (code: AppErrorCode, message: string, requestId: string) => ({
  ok: false as const,
  error: { code, message, requestId },
});
const required = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
const blocker = `CASE
  WHEN l.purpose<>'CUSTOMER_FULFILLMENT' THEN 'Warehouses do not dispatch customer orders'
  WHEN l.status<>'active' THEN 'Activate this fulfillment location'
  WHEN (SELECT COUNT(DISTINCT capability) FROM location_capability WHERE location_id=l.id AND enabled=1 AND capability IN ('PICKING','PACKING','DISPATCH'))<>3 THEN 'Configure picking, packing and dispatch capabilities'
  WHEN NOT EXISTS (SELECT 1 FROM location_operating_schedule hours WHERE hours.location_id=l.id AND hours.timezone=m.timezone AND json_array_length(hours.definition_json,'$.weekly')>0) THEN 'Configure operating hours'
  WHEN NOT EXISTS (SELECT 1 FROM fulfillment_location_delivery_profile profile WHERE profile.location_id=l.id AND length(trim(profile.sender_name))>0 AND length(trim(profile.phone_e164))>0 AND length(trim(profile.formatted_address))>0) THEN 'Configure the courier pickup profile'
  WHEN m.status<>'active' THEN 'The market is inactive'
  ELSE NULL END`;
const selection = `SELECT l.id locationId,l.name locationName,l.market_id marketId,l.purpose,l.version,r.version readinessVersion,COALESCE(r.dispatch_ready,0) dispatchReady,r.instant_promise_minutes instantPromiseMinutes,${blocker} blocker FROM fulfillment_location l JOIN market m ON m.id=l.market_id LEFT JOIN fulfillment_location_readiness r ON r.location_id=l.id`;
type Row = {
  locationId: string;
  locationName: string;
  marketId: string;
  purpose: string;
  version: number;
  readinessVersion: number | null;
  dispatchReady: number;
  instantPromiseMinutes: number | null;
  blocker: string | null;
};
async function load(db: D1Database, id: string) {
  return db.prepare(`${selection} WHERE l.id=?`).bind(id).first<Row>();
}
function view(row: Row, canManage: boolean): AdminLocationFulfillmentView {
  return {
    locationId: row.locationId,
    locationName: row.locationName,
    version: row.version,
    dispatchReady: row.dispatchReady === 1,
    instantPromiseMinutes: row.instantPromiseMinutes,
    blockers: [
      ...(row.blocker ? [row.blocker] : []),
      ...(row.instantPromiseMinutes === null
        ? ["Set an Instant delivery promise before opening Instant commerce"]
        : []),
    ],
    canManage,
  };
}
export async function getAdminLocationFulfillment(
  deps: LocationAdministrationDeps,
  input: AuthenticatedRequest & { locationId: string },
): Promise<RpcResult<AdminLocationFulfillmentView>> {
  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION_FAILED", "Select a location", input.requestId);
  const permitted = await access(deps, parsed.data, "locations.read");
  if (!permitted.ok) return permitted;
  const row = await load(deps.db, parsed.data.locationId);
  if (!row) return fail("NOT_FOUND", "Location not found", input.requestId);
  const manage = await access(deps, parsed.data, "locations.manage");
  return {
    ok: true,
    requestId: input.requestId,
    value: view(row, manage.ok && row.purpose === "CUSTOMER_FULFILLMENT"),
  };
}
export async function configureAdminLocationFulfillment(
  deps: LocationAdministrationDeps,
  input: ConfigureAdminLocationFulfillmentRequest,
): Promise<RpcResult<AdminLocationFulfillmentView>> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      "VALIDATION_FAILED",
      "Check fulfillment settings, version and reason",
      input.requestId,
    );
  const request = parsed.data,
    permitted = await access(deps, request, "locations.manage");
  if (!permitted.ok) return permitted;
  const { headers: _headers, requestId: _requestId, idempotencyKey, ...intent } = request;
  const hash = await requestHash({ ...intent, actor: permitted.authUserId }),
    scope = "admin.location-fulfillment.configure";
  async function replay(): Promise<RpcResult<AdminLocationFulfillmentView> | null> {
    const record = await deps.db
      .prepare(
        "SELECT request_hash,status,result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
      )
      .bind(scope, idempotencyKey)
      .first<{ request_hash: string; status: string; result_reference: string | null }>();
    if (!record) return null;
    if (record.request_hash !== hash)
      return fail(
        "IDEMPOTENCY_CONFLICT",
        "Key belongs to another fulfillment request",
        request.requestId,
      );
    if (record.status !== "SUCCEEDED" || !record.result_reference)
      return fail("CONFLICT", "Fulfillment request needs recovery", request.requestId);
    try {
      return {
        ok: true,
        requestId: request.requestId,
        value: adminLocationFulfillmentViewSchema.parse(JSON.parse(record.result_reference)),
      };
    } catch {
      return fail("CONFLICT", "Saved fulfillment result needs recovery", request.requestId);
    }
  }
  const prior = await replay();
  if (prior) return prior;
  const row = await load(deps.db, request.locationId);
  if (!row) return fail("NOT_FOUND", "Location not found", request.requestId);
  if (row.purpose !== "CUSTOMER_FULFILLMENT")
    return fail(
      "VALIDATION_FAILED",
      "Warehouses do not dispatch customer orders",
      request.requestId,
    );
  if (row.version !== request.expectedVersion)
    return fail("STALE_VERSION", "Location changed; refresh and review", request.requestId);
  if (request.dispatchReady && row.blocker)
    return fail("CONFIGURATION_ERROR", row.blocker, request.requestId);
  const now = Date.now();
  if (
    request.instantPromiseMinutes !== null &&
    !Number.isFinite(new Date(now + request.instantPromiseMinutes * 60000).getTime())
  )
    return fail(
      "VALIDATION_FAILED",
      "The delivery promise is outside the supported timestamp range",
      request.requestId,
    );
  const next = view(
    {
      ...row,
      version: row.version + 1,
      dispatchReady: request.dispatchReady ? 1 : 0,
      instantPromiseMinutes: request.instantPromiseMinutes,
    },
    true,
  );
  try {
    await deps.db.batch([
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
      SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global' JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='locations.manage')`)
        .bind(permitted.staffId, permitted.authUserId),
      deps.db
        .prepare(
          `INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (SELECT 1 FROM fulfillment_location l JOIN market m ON m.id=l.market_id LEFT JOIN fulfillment_location_readiness r ON r.location_id=l.id WHERE l.id=? AND l.name=? AND l.market_id=? AND l.purpose='CUSTOMER_FULFILLMENT' AND COALESCE(r.version,0)=? AND (?=0 OR (${blocker}) IS NULL))`,
        )
        .bind(
          row.locationId,
          row.locationName,
          row.marketId,
          row.readinessVersion ?? 0,
          request.dispatchReady ? 1 : 0,
        ),
      deps.db
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','location_fulfillment',?,?)",
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
        .prepare(
          `INSERT INTO fulfillment_location_readiness(location_id,instant_promise_minutes,dispatch_ready,version,created_at,updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(location_id) DO UPDATE SET instant_promise_minutes=excluded.instant_promise_minutes,dispatch_ready=excluded.dispatch_ready,version=fulfillment_location_readiness.version+1,updated_at=excluded.updated_at`,
        )
        .bind(
          row.locationId,
          request.instantPromiseMinutes,
          request.dispatchReady ? 1 : 0,
          now,
          now,
        ),
      required(deps.db),
      deps.db
        .prepare(
          "INSERT INTO geography_configuration(market_id,version,updated_at) VALUES (?,2,?) ON CONFLICT(market_id) DO UPDATE SET version=version+1,updated_at=excluded.updated_at",
        )
        .bind(row.marketId, now),
      required(deps.db),
      deps.db
        .prepare(
          `UPDATE checkout_quote SET status='SUPERSEDED',version=version+1,updated_at=? WHERE status='ACTIVE' AND json_extract(cycle_snapshot_json,'$.locationId') IN (SELECT id FROM fulfillment_location WHERE market_id=?) AND NOT EXISTS (SELECT 1 FROM payment_intent p WHERE p.subject_type='checkout_quote' AND p.subject_id=checkout_quote.id)`,
        )
        .bind(now, row.marketId),
      deps.db
        .prepare(
          `INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM checkout_quote q WHERE q.status='ACTIVE' AND json_extract(q.cycle_snapshot_json,'$.locationId') IN (SELECT id FROM fulfillment_location WHERE market_id=?) AND NOT EXISTS (SELECT 1 FROM payment_intent p WHERE p.subject_type='checkout_quote' AND p.subject_id=q.id))`,
        )
        .bind(row.marketId),
      auditEventStatement(deps.db, {
        actorUserId: permitted.authUserId,
        action: "LOCATION.FULFILLMENT_CONFIGURED",
        resourceType: "fulfillment_location",
        resourceId: row.locationId,
        marketId: row.marketId,
        locationId: row.locationId,
        reason: request.reason,
        idempotencyKey,
        correlationId: request.requestId,
        occurredAt: now,
        before: {
          version: row.version,
          dispatchReady: row.dispatchReady === 1,
          instantPromiseMinutes: row.instantPromiseMinutes,
        },
        after: {
          version: next.version,
          dispatchReady: next.dispatchReady,
          instantPromiseMinutes: next.instantPromiseMinutes,
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
      fail(
        "CONFLICT",
        "Location, readiness or access changed; refresh and review",
        request.requestId,
      )
    );
  }
  return { ok: true, requestId: request.requestId, value: next };
}
