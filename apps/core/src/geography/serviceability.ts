import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type {
  RpcResult,
  ServiceabilityFailureReason,
  ServiceabilityRequest,
  ServiceabilityResult,
} from "@freshmarkets/contracts";
import { parsePolygonGeoJson, pointInPolygon, validCoordinate } from "./geometry";
import { geographySchema } from "./schema";

type Database = ReturnType<typeof import("drizzle-orm/d1").drizzle>;
type LocationType =
  | "FULFILLMENT_CENTER"
  | "SATELLITE"
  | "CROSS_DOCK"
  | "DISPATCH_ONLY"
  | "PICKUP_POINT";

const DEFAULT_MARKET_CODE = "METRO_CEBU";
const REQUIRED_FULFILLMENT_CAPABILITIES = ["PICKING", "PACKING", "DISPATCH"] as const;

export type GeographyDataset = {
  market: {
    id: string;
    code: string;
    name: string;
    currency: string;
    timezone: string;
  } | null;
  serviceAreas: ReadonlyArray<{
    id: string;
    code: string;
    name: string;
    polygonGeoJson: string;
    polygonVersion: number;
    active: boolean;
  }>;
  deliveryZones: ReadonlyArray<{
    id: string;
    serviceAreaId: string;
    code: string;
    name: string;
    polygonGeoJson: string;
    polygonVersion: number;
    active: boolean;
  }>;
  candidates: ReadonlyArray<{
    code: string;
    name: string;
    type: LocationType;
    priority: number;
    capabilities: ReadonlyArray<string>;
    active: boolean;
  }>;
};

function result(
  request: ServiceabilityRequest,
  value: Omit<ServiceabilityResult, "coordinate" | "resolutionChanged" | "evaluatedAt">,
  now: Date,
): RpcResult<ServiceabilityResult> {
  const previous = request.previousResolution;
  const resolutionChanged = Boolean(
    previous &&
    (previous.serviceAreaCode !== value.serviceArea?.code ||
      previous.serviceAreaPolygonVersion !== value.serviceArea?.polygonVersion ||
      previous.deliveryZoneCode !== value.deliveryZone?.code ||
      previous.deliveryZonePolygonVersion !== value.deliveryZone?.polygonVersion),
  );
  return {
    ok: true,
    value: {
      ...value,
      coordinate: { latitude: request.latitude, longitude: request.longitude },
      resolutionChanged,
      evaluatedAt: now.toISOString(),
    },
    requestId: request.requestId,
  };
}

function unavailable(
  request: ServiceabilityRequest,
  reason: ServiceabilityFailureReason,
  now: Date,
): RpcResult<ServiceabilityResult> {
  return result(
    request,
    {
      serviceable: false,
      reason,
      market: null,
      serviceArea: null,
      deliveryZone: null,
      fulfillmentEligibility: { eligible: false, candidateCount: 0 },
    },
    now,
  );
}

export function evaluateServiceability(
  request: ServiceabilityRequest,
  dataset: GeographyDataset,
  now = new Date(),
): RpcResult<ServiceabilityResult> {
  if (!validCoordinate(request.latitude, request.longitude))
    return unavailable(request, "INVALID_COORDINATES", now);
  if (!dataset.market) return unavailable(request, "OUTSIDE_SERVICE_AREA", now);

  const market = {
    code: dataset.market.code,
    name: dataset.market.name,
    currency: dataset.market.currency,
    timezone: dataset.market.timezone,
  };

  const point = [request.longitude, request.latitude] as const;
  const area = dataset.serviceAreas.find((candidate) => {
    if (!candidate.active) return false;
    const polygon = parsePolygonGeoJson(candidate.polygonGeoJson);
    return polygon ? pointInPolygon(point, polygon) : false;
  });
  if (!area)
    return result(
      request,
      {
        serviceable: false,
        reason: "OUTSIDE_SERVICE_AREA",
        market,
        serviceArea: null,
        deliveryZone: null,
        fulfillmentEligibility: { eligible: false, candidateCount: 0 },
      },
      now,
    );
  const serviceArea = {
    code: area.code,
    name: area.name,
    polygonVersion: area.polygonVersion,
  };
  const zone = dataset.deliveryZones.find((candidate) => {
    if (!candidate.active || candidate.serviceAreaId !== area.id) return false;
    const polygon = parsePolygonGeoJson(candidate.polygonGeoJson);
    return polygon ? pointInPolygon(point, polygon) : false;
  });
  if (!zone) {
    return result(
      request,
      {
        serviceable: false,
        reason: "OUTSIDE_DELIVERY_ZONE",
        market,
        serviceArea,
        deliveryZone: null,
        fulfillmentEligibility: { eligible: false, candidateCount: 0 },
      },
      now,
    );
  }

  const locations = dataset.candidates
    .filter((candidate) => candidate.active)
    .filter((candidate) =>
      REQUIRED_FULFILLMENT_CAPABILITIES.every((capability) =>
        candidate.capabilities.includes(capability),
      ),
    )
    .sort((left, right) => left.priority - right.priority)
    .map(({ code, name, type }) => ({ code, name, type }));

  return result(
    request,
    {
      serviceable: locations.length > 0,
      reason: locations.length ? null : "NO_ELIGIBLE_LOCATION",
      market,
      serviceArea,
      deliveryZone: { code: zone.code, name: zone.name, polygonVersion: zone.polygonVersion },
      fulfillmentEligibility: { eligible: locations.length > 0, candidateCount: locations.length },
    },
    now,
  );
}

export async function resolveServiceability(
  database: Database,
  request: ServiceabilityRequest,
): Promise<RpcResult<ServiceabilityResult>> {
  const now = new Date();
  if (!validCoordinate(request.latitude, request.longitude))
    return unavailable(request, "INVALID_COORDINATES", now);

  const marketRows = await database
    .select()
    .from(geographySchema.market)
    .where(
      and(
        eq(geographySchema.market.code, request.marketCode ?? DEFAULT_MARKET_CODE),
        eq(geographySchema.market.status, "active"),
      ),
    )
    .limit(1);
  const market = marketRows[0] ?? null;
  if (!market)
    return evaluateServiceability(
      request,
      { market: null, serviceAreas: [], deliveryZones: [], candidates: [] },
      now,
    );

  const serviceAreas = await database
    .select()
    .from(geographySchema.serviceArea)
    .where(
      and(
        eq(geographySchema.serviceArea.marketId, market.id),
        eq(geographySchema.serviceArea.status, "active"),
        lte(geographySchema.serviceArea.activeFrom, now),
        or(
          isNull(geographySchema.serviceArea.activeTo),
          gt(geographySchema.serviceArea.activeTo, now),
        ),
      ),
    )
    .orderBy(desc(geographySchema.serviceArea.polygonVersion));
  const areaIds = serviceAreas.map((area) => area.id);
  const deliveryZones = areaIds.length
    ? await database
        .select()
        .from(geographySchema.deliveryZone)
        .where(
          and(
            inArray(geographySchema.deliveryZone.serviceAreaId, areaIds),
            eq(geographySchema.deliveryZone.status, "active"),
          ),
        )
        .orderBy(desc(geographySchema.deliveryZone.polygonVersion))
    : [];
  const zoneIds = deliveryZones.map((zone) => zone.id);
  const assignments = zoneIds.length
    ? await database
        .select({
          zoneId: geographySchema.locationServiceability.zoneId,
          locationId: geographySchema.fulfillmentLocation.id,
          code: geographySchema.fulfillmentLocation.code,
          name: geographySchema.fulfillmentLocation.name,
          type: geographySchema.fulfillmentLocation.type,
          priority: geographySchema.locationServiceability.priority,
        })
        .from(geographySchema.locationServiceability)
        .innerJoin(
          geographySchema.fulfillmentLocation,
          eq(
            geographySchema.fulfillmentLocation.id,
            geographySchema.locationServiceability.locationId,
          ),
        )
        .where(
          and(
            inArray(geographySchema.locationServiceability.zoneId, zoneIds),
            eq(geographySchema.locationServiceability.eligible, true),
            eq(geographySchema.fulfillmentLocation.marketId, market.id),
            eq(geographySchema.fulfillmentLocation.status, "active"),
            lte(geographySchema.locationServiceability.validFrom, now),
            or(
              isNull(geographySchema.locationServiceability.validTo),
              gt(geographySchema.locationServiceability.validTo, now),
            ),
          ),
        )
        .orderBy(asc(geographySchema.locationServiceability.priority))
    : [];
  const locationIds = [...new Set(assignments.map((candidate) => candidate.locationId))];
  const capabilities = locationIds.length
    ? await database
        .select()
        .from(geographySchema.locationCapability)
        .where(
          and(
            inArray(geographySchema.locationCapability.locationId, locationIds),
            eq(geographySchema.locationCapability.enabled, true),
          ),
        )
    : [];

  return evaluateServiceability(
    request,
    {
      market,
      serviceAreas: serviceAreas.map((area) => ({ ...area, active: true })),
      deliveryZones: deliveryZones.map((zone) => ({ ...zone, active: true })),
      candidates: assignments.map((candidate) => ({
        code: candidate.code,
        name: candidate.name,
        type: candidate.type,
        priority: candidate.priority,
        active: true,
        capabilities: capabilities
          .filter((capability) => capability.locationId === candidate.locationId)
          .map((capability) => capability.capability),
      })),
    },
    now,
  );
}
