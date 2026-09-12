import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type {
  RpcResult,
  ServiceabilityFailureReason,
  ServiceabilityRequest,
  ServiceabilityResult,
} from "@freshmarkets/contracts";
import {
  haversineDistanceMeters,
  parsePolygonGeoJson,
  pointInPolygon,
  validCoordinate,
} from "./geometry";
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
    code: string;
    name: string;
    polygonVersion: number;
    polygonGeojson: string;
  }>;
  candidates: ReadonlyArray<{
    id: string;
    code: string;
    name: string;
    type: LocationType;
    latitude: number;
    longitude: number;
    capabilities: ReadonlyArray<string>;
    active: boolean;
  }>;
};

export type GlobalServiceArea = GeographyDataset["serviceAreas"][number];

/** Active market-level boundaries are a union; they never select or own a location. */
export function matchingServiceAreas<T extends GlobalServiceArea>(
  coordinate: { latitude: number; longitude: number },
  areas: ReadonlyArray<T>,
): T[] {
  return areas.filter((area) => {
    const polygon = parsePolygonGeoJson(area.polygonGeojson);
    return polygon ? pointInPolygon([coordinate.longitude, coordinate.latitude], polygon) : false;
  });
}

function result(
  request: ServiceabilityRequest,
  value: Omit<ServiceabilityResult, "coordinate" | "resolutionChanged" | "evaluatedAt"> & {
    resolutionChanged?: boolean;
  },
  now: Date,
): RpcResult<ServiceabilityResult> {
  return {
    ok: true,
    value: {
      ...value,
      coordinate: { latitude: request.latitude, longitude: request.longitude },
      // Retained for contract compatibility with addresses saved before pin-based assignment.
      resolutionChanged: value.resolutionChanged ?? false,
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
  if (!dataset.market) return unavailable(request, "NO_ELIGIBLE_LOCATION", now);

  const market = {
    code: dataset.market.code,
    name: dataset.market.name,
    currency: dataset.market.currency,
    timezone: dataset.market.timezone,
  };
  const serviceArea = matchingServiceAreas(request, dataset.serviceAreas)[0] ?? null;
  if (!serviceArea)
    return result(
      request,
      {
        serviceable: false,
        reason: "OUTSIDE_SERVICE_AREA",
        market,
        serviceArea: null,
        deliveryZone: null,
        fulfillmentEligibility: { eligible: false, candidateCount: 0 },
        resolutionChanged:
          request.previousResolution !== undefined &&
          request.previousResolution.serviceAreaCode.length > 0,
      },
      now,
    );

  const locations = dataset.candidates
    .filter((candidate) => candidate.active)
    .filter((candidate) =>
      REQUIRED_FULFILLMENT_CAPABILITIES.every((capability) =>
        candidate.capabilities.includes(capability),
      ),
    )
    .sort((left, right) => {
      const distance =
        haversineDistanceMeters(request, left) - haversineDistanceMeters(request, right);
      return distance !== 0 ? distance : left.id.localeCompare(right.id);
    });
  const count = new Set(locations.map((location) => location.id)).size;

  return result(
    request,
    {
      serviceable: locations.length > 0,
      fulfillmentLocation: locations[0] ? { id: locations[0].id, name: locations[0].name } : null,
      reason: locations.length ? null : "NO_ELIGIBLE_LOCATION",
      market,
      serviceArea: {
        code: serviceArea.code,
        name: serviceArea.name,
        polygonVersion: serviceArea.polygonVersion,
      },
      deliveryZone: null,
      fulfillmentEligibility: { eligible: count > 0, candidateCount: count },
      resolutionChanged:
        request.previousResolution !== undefined &&
        (request.previousResolution.serviceAreaCode !== serviceArea.code ||
          request.previousResolution.serviceAreaPolygonVersion !== serviceArea.polygonVersion),
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

  const marketQuery = database
    .select()
    .from(geographySchema.market)
    .where(
      and(
        eq(geographySchema.market.code, request.marketCode ?? DEFAULT_MARKET_CODE),
        eq(geographySchema.market.status, "active"),
      ),
    )
    .limit(1);
  const marketSelection = marketQuery.as("selected_market");
  const marketIds = database.select({ id: marketSelection.id }).from(marketSelection);
  const locationsQuery = database
    .select({
      locationId: geographySchema.fulfillmentLocation.id,
      code: geographySchema.fulfillmentLocation.code,
      name: geographySchema.fulfillmentLocation.name,
      type: geographySchema.fulfillmentLocation.type,
      latitude: geographySchema.fulfillmentLocation.latitude,
      longitude: geographySchema.fulfillmentLocation.longitude,
    })
    .from(geographySchema.fulfillmentLocation)
    .where(
      and(
        inArray(geographySchema.fulfillmentLocation.marketId, marketIds),
        eq(geographySchema.fulfillmentLocation.status, "active"),
        eq(geographySchema.fulfillmentLocation.purpose, "CUSTOMER_FULFILLMENT"),
      ),
    )
    .orderBy(asc(geographySchema.fulfillmentLocation.id));
  const serviceAreasQuery = database
    .select({
      code: geographySchema.serviceArea.code,
      name: geographySchema.serviceArea.name,
      polygonVersion: geographySchema.serviceArea.polygonVersion,
      polygonGeojson: geographySchema.serviceArea.polygonGeoJson,
    })
    .from(geographySchema.serviceArea)
    .where(
      and(
        inArray(geographySchema.serviceArea.marketId, marketIds),
        eq(geographySchema.serviceArea.status, "active"),
        lte(geographySchema.serviceArea.activeFrom, now),
        or(
          isNull(geographySchema.serviceArea.activeTo),
          gt(geographySchema.serviceArea.activeTo, now),
        ),
      ),
    )
    .orderBy(asc(geographySchema.serviceArea.code), asc(geographySchema.serviceArea.id));
  const assignmentSelection = locationsQuery.as("selected_locations");
  const locationIds = database
    .select({ id: assignmentSelection.locationId })
    .from(assignmentSelection);
  const capabilitiesQuery = database
    .select()
    .from(geographySchema.locationCapability)
    .where(
      and(
        inArray(geographySchema.locationCapability.locationId, locationIds),
        eq(geographySchema.locationCapability.enabled, true),
      ),
    );

  // Global areas gate the market. Pins own assignment; courier quotations own route coverage.
  const [marketRows, serviceAreas, locations, capabilities] = await database.batch([
    marketQuery,
    serviceAreasQuery,
    locationsQuery,
    capabilitiesQuery,
  ]);
  const market = marketRows[0] ?? null;
  return evaluateServiceability(
    request,
    {
      market,
      serviceAreas,
      candidates: locations.map((candidate) => ({
        id: candidate.locationId,
        code: candidate.code,
        name: candidate.name,
        type: candidate.type,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        active: true,
        capabilities: capabilities
          .filter((capability) => capability.locationId === candidate.locationId)
          .map((capability) => capability.capability),
      })),
    },
    now,
  );
}
