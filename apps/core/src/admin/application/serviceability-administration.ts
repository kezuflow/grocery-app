import type {
  AdminServiceAreaView,
  AdminServiceabilityPreview,
  AdminServiceabilityRequest,
  AdminServiceabilityView,
  AppErrorCode,
  Coordinate,
  PreviewAdminServiceabilityRequest,
  PublishAdminServiceAreaRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  adminServiceAreaViewSchema,
  idempotencyKeySchema,
  identifierSchema,
  serviceAreaDefinitionSchema,
  serviceCoordinateSchema,
  z,
} from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { requestHash } from "../../idempotency";
import { parsePolygonGeoJson } from "../../geography/geometry";
import { operationalCandidates } from "../../geography/application/operational-candidates";
import { matchingServiceAreas } from "../../geography/serviceability";
import { servicePolygon } from "../../geography/domain/service-polygon";
import { authenticatedRequestSchema } from "../../validation";
import { resolveLocationAdministrationAccess as access } from "./location-administration";
import type { StaffAdministrationDeps } from "./staff-administration-access";

const requirePublicationEffect = (database: D1Database) =>
  database.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");

const publishSchema = authenticatedRequestSchema.extend({
  ...serviceAreaDefinitionSchema.shape,
  expectedVersion: z
    .number()
    .int()
    .safe()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});
const previewSchema = authenticatedRequestSchema.extend({
  ...serviceCoordinateSchema.shape,
  marketId: identifierSchema,
});

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function vertices(json: string): Coordinate[] | null {
  const polygon = parsePolygonGeoJson(json);
  // The editor owns one simple exterior. Never silently discard retained holes.
  if (!polygon || polygon.length !== 1) return null;
  return polygon[0].slice(0, -1).map(([longitude, latitude]) => ({ latitude, longitude }));
}

export async function getAdminServiceability(
  dependencies: StaffAdministrationDeps,
  input: AdminServiceabilityRequest,
): Promise<RpcResult<AdminServiceabilityView>> {
  const parsed = authenticatedRequestSchema
    .extend({ cursor: z.string().max(1000).optional() })
    .safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_FAILED", "Invalid service-area query", input.requestId);
  const permitted = await access(dependencies, parsed.data, "locations.read");
  if (!permitted.ok) return permitted;

  const cursorSchema = z.object({ marketId: identifierSchema, code: identifierSchema });
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (parsed.data.cursor) {
    try {
      cursor = cursorSchema.parse(JSON.parse(atob(parsed.data.cursor)));
    } catch {
      return failure("VALIDATION_FAILED", "Invalid service-area cursor", input.requestId);
    }
  }
  const now = Date.now();
  const [areas, markets, manage] = await Promise.all([
    dependencies.db
      .prepare(`SELECT id serviceAreaId,market_id marketId,code,name,polygon_version version,polygon_geojson polygon
        FROM service_area area WHERE status='active' AND active_from<=?
          AND (active_to IS NULL OR active_to>?)
          AND (? IS NULL OR (market_id,code)>(?,?)) ORDER BY market_id,code LIMIT 21`)
      .bind(now, now, cursor?.marketId ?? null, cursor?.marketId ?? "", cursor?.code ?? "")
      .all<{
        serviceAreaId: string;
        marketId: string;
        code: string;
        name: string;
        version: number;
        polygon: string;
      }>(),
    dependencies.db
      .prepare(
        "SELECT id marketId,name FROM market WHERE status='active' ORDER BY name,id LIMIT 100",
      )
      .all<{ marketId: string; name: string }>(),
    access(dependencies, parsed.data, "locations.manage"),
  ]);
  const page = areas.results.slice(0, 20);
  const views: AdminServiceAreaView[] = [];
  for (const area of page) {
    const boundary = vertices(area.polygon);
    if (!boundary)
      return failure(
        "CONFIGURATION_ERROR",
        "A retained service area has complex geometry requiring a reviewed import",
        input.requestId,
      );
    views.push({
      serviceAreaId: area.serviceAreaId,
      marketId: area.marketId,
      code: area.code,
      name: area.name,
      version: area.version,
      vertices: boundary,
    });
  }
  const last = page.at(-1);
  return {
    ok: true,
    requestId: input.requestId,
    value: {
      areas: views,
      nextCursor:
        areas.results.length > 20 && last
          ? btoa(JSON.stringify({ marketId: last.marketId, code: last.code }))
          : null,
      markets: markets.results,
      canManage: manage.ok,
    },
  };
}

export async function previewAdminServiceability(
  dependencies: StaffAdministrationDeps,
  input: PreviewAdminServiceabilityRequest,
): Promise<RpcResult<AdminServiceabilityPreview>> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_FAILED", "Check market and coordinates", input.requestId);
  const permitted = await access(dependencies, parsed.data, "locations.read");
  if (!permitted.ok) return permitted;
  const now = Date.now();
  const areas = await dependencies.db
    .prepare(`SELECT code,name,polygon_version polygonVersion,polygon_geojson polygonGeojson
      FROM service_area WHERE market_id=? AND status='active' AND active_from<=?
        AND (active_to IS NULL OR active_to>?) ORDER BY code,id`)
    .bind(parsed.data.marketId, now, now)
    .all<{
      code: string;
      name: string;
      polygonVersion: number;
      polygonGeojson: string;
    }>();
  const area = matchingServiceAreas(parsed.data, areas.results)[0] ?? null;
  if (!area)
    return {
      ok: true,
      requestId: input.requestId,
      value: {
        serviceable: false,
        locationId: null,
        locationName: null,
        serviceAreaName: null,
        reason: "This address is outside every active service area",
      },
    };
  const candidate = (
    await operationalCandidates(dependencies.db, parsed.data, {
      marketId: parsed.data.marketId,
      now,
    })
  )[0];
  return {
    ok: true,
    requestId: input.requestId,
    value: candidate
      ? {
          serviceable: true,
          locationId: candidate.locationId,
          locationName: candidate.locationName,
          serviceAreaName: area.name,
          reason: null,
        }
      : {
          serviceable: false,
          locationId: null,
          locationName: null,
          serviceAreaName: area.name,
          reason: "The area is active, but no fulfillment location is ready in the current mode",
        },
  };
}

export async function publishAdminServiceArea(
  dependencies: StaffAdministrationDeps,
  input: PublishAdminServiceAreaRequest,
): Promise<RpcResult<AdminServiceAreaView>> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_FAILED", "Check area boundary, version and reason", input.requestId);
  const request = parsed.data;
  const permitted = await access(dependencies, request, "locations.manage");
  if (!permitted.ok) return permitted;
  const { headers: _headers, requestId: _requestId, idempotencyKey, ...intent } = request;
  const hash = await requestHash({ actor: permitted.authUserId, ...intent });
  const scope = "admin.serviceability.publish";
  async function replay(): Promise<RpcResult<AdminServiceAreaView> | null> {
    const saved = await dependencies.db
      .prepare(
        "SELECT request_hash hash,status,result_reference result FROM idempotency_records WHERE scope=? AND idempotency_key=?",
      )
      .bind(scope, idempotencyKey)
      .first<{ hash: string; status: string; result: string | null }>();
    if (!saved) return null;
    if (saved.hash !== hash)
      return failure(
        "CONFLICT",
        "This key belongs to different service-area details",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED" || !saved.result)
      return failure("CONFLICT", "Service-area publication is still pending", request.requestId);
    return {
      ok: true,
      requestId: request.requestId,
      value: adminServiceAreaViewSchema.parse(JSON.parse(saved.result)),
    };
  }
  const prior = await replay();
  if (prior) return prior;
  const polygon = servicePolygon(request.vertices);
  if (!polygon)
    return failure(
      "VALIDATION_FAILED",
      "Draw one simple service-area boundary with at least three distinct points",
      request.requestId,
    );

  const now = Date.now();
  const serviceAreaId = crypto.randomUUID();
  const value: AdminServiceAreaView = {
    marketId: request.marketId,
    code: request.code,
    name: request.name,
    vertices: request.vertices,
    serviceAreaId,
    version: request.expectedVersion + 1,
  };
  const statements: D1PreparedStatement[] = [
    dependencies.db
      .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity staff JOIN staff_scope scope ON scope.staff_id=staff.id AND scope.scope_kind='global'
        JOIN staff_role role ON role.staff_id=staff.id JOIN role_permission grant_row ON grant_row.role_id=role.role_id
        JOIN permission permission ON permission.id=grant_row.permission_id
        WHERE staff.id=? AND staff.auth_user_id=? AND staff.status='active' AND permission.code='locations.manage')
        OR NOT EXISTS (SELECT 1 FROM market WHERE id=? AND status='active')
        OR COALESCE((SELECT MAX(polygon_version) FROM service_area WHERE market_id=? AND code=?),0)<>?`)
      .bind(
        permitted.staffId,
        permitted.authUserId,
        request.marketId,
        request.marketId,
        request.code,
        request.expectedVersion,
      ),
    dependencies.db
      .prepare(
        "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','service_area',?,?)",
      )
      .bind(scope, idempotencyKey, hash, now, now),
    requirePublicationEffect(dependencies.db),
    dependencies.db
      .prepare(
        "UPDATE service_area SET status='inactive',active_to=?,updated_at=? WHERE market_id=? AND code=? AND status='active'",
      )
      .bind(now, now, request.marketId, request.code),
    dependencies.db
      .prepare(
        "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM service_area WHERE market_id=? AND code=? AND status='active')",
      )
      .bind(request.marketId, request.code),
    dependencies.db
      .prepare(
        "INSERT INTO service_area(id,market_id,code,name,polygon_geojson,polygon_version,active_from,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?)",
      )
      .bind(
        serviceAreaId,
        request.marketId,
        request.code,
        request.name,
        JSON.stringify({ type: "Polygon", coordinates: [polygon] }),
        value.version,
        now,
        now,
        now,
      ),
    requirePublicationEffect(dependencies.db),
    dependencies.db
      .prepare(
        "INSERT INTO geography_configuration(market_id,version,updated_at) VALUES (?,2,?) ON CONFLICT(market_id) DO UPDATE SET version=version+1,updated_at=excluded.updated_at",
      )
      .bind(request.marketId, now),
    requirePublicationEffect(dependencies.db),
    dependencies.db
      .prepare(`UPDATE checkout_quote SET status='SUPERSEDED',version=version+1,updated_at=?
        WHERE status='ACTIVE' AND json_extract(cycle_snapshot_json,'$.locationId') IN
          (SELECT id FROM fulfillment_location WHERE market_id=?)
        AND NOT EXISTS (SELECT 1 FROM payment_intent payment WHERE payment.purpose='GROCERY_CHECKOUT'
          AND payment.subject_type='checkout_quote' AND payment.subject_id=checkout_quote.id)`)
      .bind(now, request.marketId),
    dependencies.db
      .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (
        SELECT 1 FROM checkout_quote WHERE status='ACTIVE'
        AND json_extract(cycle_snapshot_json,'$.locationId') IN
          (SELECT id FROM fulfillment_location WHERE market_id=?)
        AND NOT EXISTS (SELECT 1 FROM payment_intent payment WHERE payment.purpose='GROCERY_CHECKOUT'
          AND payment.subject_type='checkout_quote' AND payment.subject_id=checkout_quote.id))`)
      .bind(request.marketId),
    auditEventStatement(dependencies.db, {
      actorUserId: permitted.authUserId,
      action: "SERVICE_AREA.PUBLISH",
      resourceType: "service_area",
      resourceId: serviceAreaId,
      marketId: request.marketId,
      reason: request.reason,
      idempotencyKey,
      correlationId: request.requestId,
      occurredAt: now,
      before: { version: request.expectedVersion },
      after: { version: value.version },
    }),
    requirePublicationEffect(dependencies.db),
    dependencies.db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=?",
      )
      .bind(JSON.stringify(value), now, scope, idempotencyKey),
    requirePublicationEffect(dependencies.db),
  ];
  try {
    await dependencies.db.batch(statements);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (
      error instanceof Error &&
      /admin_command_abort|CHECK constraint failed: id = 0|UNIQUE constraint failed/.test(
        error.message,
      )
    )
      return failure("CONFLICT", "Area or access changed; refresh and review", request.requestId);
    throw error;
  }
  return { ok: true, requestId: request.requestId, value };
}
