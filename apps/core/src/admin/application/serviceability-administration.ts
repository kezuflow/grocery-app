import type {
  AdminServiceAreaView,
  AdminServiceabilityView,
  AdminServiceabilityPreview,
  AdminServiceabilityRequest,
  PublishAdminServiceAreaRequest,
  PreviewAdminServiceabilityRequest,
  RpcResult,
  AppErrorCode,
  Coordinate,
} from "@freshmarkets/contracts";
import {
  z,
  serviceAreaDefinitionSchema,
  serviceCoordinateSchema,
  adminServiceAreaViewSchema,
  idempotencyKeySchema,
  identifierSchema,
} from "@freshmarkets/validation";
import { authenticatedRequestSchema } from "../../validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { parsePolygonGeoJson } from "../../geography/geometry";
import { servicePolygon, polygonWithin } from "../../geography/domain/service-polygon";
import { operationalCandidates } from "../../geography/application/operational-candidates";
import { resolveLocationAdministrationAccess as access } from "./location-administration";
import type { StaffAdministrationDeps } from "./staff-administration-access";

const requirePublicationEffect = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");

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
  // Never silently flatten a retained polygon containing holes into an editable exterior.
  if (!polygon || polygon.length !== 1) return null;
  return polygon[0].slice(0, -1).map(([longitude, latitude]) => ({ latitude, longitude }));
}

export async function getAdminServiceability(
  deps: StaffAdministrationDeps,
  input: AdminServiceabilityRequest,
): Promise<RpcResult<AdminServiceabilityView>> {
  const parsed = authenticatedRequestSchema
    .extend({
      cursor: z.string().max(1000).optional(),
      locationCursor: identifierSchema.optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_FAILED", "Invalid service-area query", input.requestId);
  const permitted = await access(deps, parsed.data, "locations.read");
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
  const areas = await deps.db
    .prepare(`SELECT id serviceAreaId,market_id marketId,code,name,polygon_version version,polygon_geojson polygon FROM service_area a
    WHERE polygon_version=(SELECT MAX(polygon_version) FROM service_area WHERE market_id=a.market_id AND code=a.code)
      AND (? IS NULL OR (market_id,code)>(?,?)) ORDER BY market_id,code LIMIT 21`)
    .bind(cursor?.marketId ?? null, cursor?.marketId ?? "", cursor?.code ?? "")
    .all<{
      serviceAreaId: string;
      marketId: string;
      code: string;
      name: string;
      version: number;
      polygon: string;
    }>();
  const page = areas.results.slice(0, 20),
    last = page.at(-1);
  const ids = JSON.stringify(page.map((area) => area.serviceAreaId));
  const [zones, links, locations, markets, manage] = await Promise.all([
    deps.db
      .prepare(
        "SELECT id,service_area_id serviceAreaId,code,name,polygon_geojson polygon FROM delivery_zone WHERE service_area_id IN (SELECT value FROM json_each(?)) ORDER BY code,id",
      )
      .bind(ids)
      .all<{ id: string; serviceAreaId: string; code: string; name: string; polygon: string }>(),
    deps.db
      .prepare(
        "SELECT link.zone_id zoneId,link.location_id locationId FROM location_serviceability link JOIN delivery_zone zone ON zone.id=link.zone_id WHERE zone.service_area_id IN (SELECT value FROM json_each(?)) AND link.eligible=1 AND link.valid_from<=? AND (link.valid_to IS NULL OR link.valid_to>?) ORDER BY location_id",
      )
      .bind(ids, Date.now(), Date.now())
      .all<{ zoneId: string; locationId: string }>(),
    deps.db
      .prepare(
        "SELECT id locationId,market_id marketId,name FROM fulfillment_location WHERE purpose='CUSTOMER_FULFILLMENT' AND status='active' AND (? IS NULL OR id>?) ORDER BY id LIMIT 51",
      )
      .bind(parsed.data.locationCursor ?? null, parsed.data.locationCursor ?? "")
      .all<AdminServiceabilityView["locations"][number]>(),
    deps.db
      .prepare(
        "SELECT id marketId,name FROM market WHERE status='active' ORDER BY name,id LIMIT 100",
      )
      .all<AdminServiceabilityView["markets"][number]>(),
    access(deps, parsed.data, "locations.manage"),
  ]);
  // Keep current assignments reviewable even when a referenced site is inactive or on another picker page.
  const assigned = await deps.db
    .prepare(`SELECT DISTINCT l.id locationId,l.market_id marketId,l.name,l.status,l.purpose FROM fulfillment_location l
    JOIN location_serviceability link ON link.location_id=l.id JOIN delivery_zone zone ON zone.id=link.zone_id
    WHERE zone.service_area_id IN (SELECT value FROM json_each(?)) AND link.eligible=1 AND (link.valid_to IS NULL OR link.valid_to>?)`)
    .bind(ids, Date.now())
    .all<{ locationId: string; marketId: string; name: string; status: string; purpose: string }>();
  const choices = new Map(
    locations.results.slice(0, 50).map((location) => [location.locationId, location]),
  );
  for (const location of assigned.results)
    choices.set(location.locationId, {
      locationId: location.locationId,
      marketId: location.marketId,
      name: location.name,
      unavailable: location.status !== "active" || location.purpose !== "CUSTOMER_FULFILLMENT",
    });
  const views: AdminServiceAreaView[] = [];
  for (const area of page) {
    const boundary = vertices(area.polygon);
    if (!boundary)
      return failure(
        "CONFIGURATION_ERROR",
        "A retained service area has complex geometry requiring a reviewed import",
        input.requestId,
      );
    const definitions: AdminServiceAreaView["zones"][number][] = [];
    for (const zone of zones.results.filter((zone) => zone.serviceAreaId === area.serviceAreaId)) {
      const points = vertices(zone.polygon);
      if (!points)
        return failure(
          "CONFIGURATION_ERROR",
          "A retained delivery zone has complex geometry requiring a reviewed import",
          input.requestId,
        );
      definitions.push({
        code: zone.code,
        name: zone.name,
        vertices: points,
        locationIds: links.results
          .filter((link) => link.zoneId === zone.id)
          .map((link) => link.locationId),
      });
    }
    views.push({
      serviceAreaId: area.serviceAreaId,
      marketId: area.marketId,
      code: area.code,
      name: area.name,
      version: area.version,
      vertices: boundary,
      zones: definitions,
    });
  }
  return {
    ok: true,
    requestId: input.requestId,
    value: {
      areas: views,
      nextCursor:
        areas.results.length > 20 && last
          ? btoa(JSON.stringify({ marketId: last.marketId, code: last.code }))
          : null,
      locationsNextCursor: locations.results.length > 50 ? locations.results[49].locationId : null,
      locations: [...choices.values()],
      markets: markets.results,
      canManage: manage.ok,
    },
  };
}

export async function previewAdminServiceability(
  deps: StaffAdministrationDeps,
  input: PreviewAdminServiceabilityRequest,
): Promise<RpcResult<AdminServiceabilityPreview>> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_FAILED", "Check market and coordinates", input.requestId);
  const permitted = await access(deps, parsed.data, "locations.read");
  if (!permitted.ok) return permitted;
  const candidate = (
    await operationalCandidates(deps.db, parsed.data, { marketId: parsed.data.marketId })
  )[0];
  return {
    ok: true,
    requestId: input.requestId,
    value: candidate
      ? {
          serviceable: true,
          locationId: candidate.locationId,
          locationName: candidate.locationName,
          zoneName: candidate.zoneName,
          reason: null,
        }
      : {
          serviceable: false,
          locationId: null,
          locationName: null,
          zoneName: null,
          reason:
            "No eligible location and fulfillment promise cover this point in the current mode",
        },
  };
}

export async function publishAdminServiceArea(
  deps: StaffAdministrationDeps,
  input: PublishAdminServiceAreaRequest,
): Promise<RpcResult<AdminServiceAreaView>> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Check area, zones, locations, version and reason",
      input.requestId,
    );
  const request = parsed.data;
  const permitted = await access(deps, request, "locations.manage");
  if (!permitted.ok) return permitted;
  const { headers: _headers, requestId: _requestId, idempotencyKey, ...intent } = request;
  const hash = await requestHash({ actor: permitted.authUserId, ...intent }),
    scope = "admin.serviceability.publish";
  async function replay(): Promise<RpcResult<AdminServiceAreaView> | null> {
    const saved = await deps.db
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
  const area = servicePolygon(request.vertices);
  const polygons = request.zones.map((zone) => servicePolygon(zone.vertices));
  if (!area || polygons.some((zone) => !zone || !polygonWithin(zone, area)))
    return failure(
      "VALIDATION_FAILED",
      "Draw simple boundaries with every delivery zone inside its service area",
      request.requestId,
    );
  const now = Date.now(),
    serviceAreaId = crypto.randomUUID();
  const value: AdminServiceAreaView = {
    marketId: request.marketId,
    code: request.code,
    name: request.name,
    vertices: request.vertices,
    zones: request.zones,
    serviceAreaId,
    version: request.expectedVersion + 1,
  };
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
      SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global'
      JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
      WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='locations.manage')
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
    deps.db
      .prepare(
        "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','service_area',?,?)",
      )
      .bind(scope, idempotencyKey, hash, now, now),
    requirePublicationEffect(deps.db),
  ];
  for (const locationId of new Set(request.zones.flatMap((zone) => zone.locationIds)))
    statements.push(
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (SELECT 1 FROM fulfillment_location WHERE id=? AND market_id=? AND status='active' AND purpose='CUSTOMER_FULFILLMENT')",
        )
        .bind(locationId, request.marketId),
    );
  statements.push(
    deps.db
      .prepare(
        "UPDATE location_serviceability SET valid_to=? WHERE valid_to IS NULL AND zone_id IN (SELECT z.id FROM delivery_zone z JOIN service_area a ON a.id=z.service_area_id WHERE a.market_id=? AND a.code=?)",
      )
      .bind(now, request.marketId, request.code),
    deps.db
      .prepare(
        "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM location_serviceability WHERE valid_to IS NULL AND zone_id IN (SELECT z.id FROM delivery_zone z JOIN service_area a ON a.id=z.service_area_id WHERE a.market_id=? AND a.code=?))",
      )
      .bind(request.marketId, request.code),
    deps.db
      .prepare(
        "UPDATE delivery_zone SET status='inactive',updated_at=? WHERE service_area_id IN (SELECT id FROM service_area WHERE market_id=? AND code=?)",
      )
      .bind(now, request.marketId, request.code),
    deps.db
      .prepare(
        "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM delivery_zone WHERE status!='inactive' AND service_area_id IN (SELECT id FROM service_area WHERE market_id=? AND code=?))",
      )
      .bind(request.marketId, request.code),
    deps.db
      .prepare(
        "UPDATE service_area SET status='inactive',active_to=?,updated_at=? WHERE market_id=? AND code=? AND status='active'",
      )
      .bind(now, now, request.marketId, request.code),
    deps.db
      .prepare(
        "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM service_area WHERE market_id=? AND code=? AND status='active')",
      )
      .bind(request.marketId, request.code),
    deps.db
      .prepare(
        "INSERT INTO service_area(id,market_id,code,name,polygon_geojson,polygon_version,active_from,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?)",
      )
      .bind(
        serviceAreaId,
        request.marketId,
        request.code,
        request.name,
        JSON.stringify({ type: "Polygon", coordinates: [area] }),
        value.version,
        now,
        now,
        now,
      ),
    requirePublicationEffect(deps.db),
  );
  request.zones.forEach((zone, index) => {
    const zoneId = crypto.randomUUID();
    statements.push(
      deps.db
        .prepare(
          "INSERT INTO delivery_zone(id,service_area_id,code,name,polygon_geojson,polygon_version,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',?,?)",
        )
        .bind(
          zoneId,
          serviceAreaId,
          zone.code,
          zone.name,
          JSON.stringify({ type: "Polygon", coordinates: [polygons[index]] }),
          value.version,
          now,
          now,
        ),
      requirePublicationEffect(deps.db),
    );
    for (const locationId of zone.locationIds)
      statements.push(
        deps.db
          .prepare(
            "INSERT INTO location_serviceability(zone_id,location_id,priority,eligible,valid_from) VALUES (?,?,0,1,?)",
          )
          .bind(zoneId, locationId, now),
        requirePublicationEffect(deps.db),
      );
  });
  statements.push(
    deps.db
      .prepare(
        "INSERT INTO geography_configuration(market_id,version,updated_at) VALUES (?,2,?) ON CONFLICT(market_id) DO UPDATE SET version=version+1,updated_at=excluded.updated_at",
      )
      .bind(request.marketId, now),
    requirePublicationEffect(deps.db),
    deps.db
      .prepare(`UPDATE checkout_quote SET status='SUPERSEDED',version=version+1,updated_at=? WHERE status='ACTIVE'
      AND json_extract(cycle_snapshot_json,'$.locationId') IN (SELECT id FROM fulfillment_location WHERE market_id=?)
      AND NOT EXISTS (SELECT 1 FROM payment_intent p WHERE p.purpose='GROCERY_CHECKOUT' AND p.subject_type='checkout_quote' AND p.subject_id=checkout_quote.id)`)
      .bind(now, request.marketId),
    deps.db
      .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (
      SELECT 1 FROM checkout_quote WHERE status='ACTIVE'
      AND json_extract(cycle_snapshot_json,'$.locationId') IN (SELECT id FROM fulfillment_location WHERE market_id=?)
      AND NOT EXISTS (SELECT 1 FROM payment_intent p WHERE p.purpose='GROCERY_CHECKOUT' AND p.subject_type='checkout_quote' AND p.subject_id=checkout_quote.id))`)
      .bind(request.marketId),
    auditEventStatement(deps.db, {
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
      after: { version: value.version, zoneCount: request.zones.length },
    }),
    requirePublicationEffect(deps.db),
    deps.db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=?",
      )
      .bind(JSON.stringify(value), now, scope, idempotencyKey),
    requirePublicationEffect(deps.db),
  );
  try {
    await deps.db.batch(statements);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (
      error instanceof Error &&
      /admin_command_abort|CHECK constraint failed: id = 0|UNIQUE constraint failed/.test(
        error.message,
      )
    )
      return failure(
        "CONFLICT",
        "Area, location or access changed; refresh and review",
        request.requestId,
      );
    throw error;
  }
  return { ok: true, requestId: request.requestId, value };
}
