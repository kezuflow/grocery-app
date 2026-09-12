import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  RpcResult,
  ServiceabilityFailureReason,
  ServiceabilityRequest,
  ServiceabilityResult,
} from "@freshmarkets/contracts";
import { haversineDistanceMeters, validCoordinate } from "./geometry";
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

function result(
  request: ServiceabilityRequest,
  value: Omit<ServiceabilityResult, "coordinate" | "resolutionChanged" | "evaluatedAt">,
  now: Date,
): RpcResult<ServiceabilityResult> {
  return {
    ok: true,
    value: {
      ...value,
      coordinate: { latitude: request.latitude, longitude: request.longitude },
      // Retained for contract compatibility with addresses saved before pin-based assignment.
      resolutionChanged: false,
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
      serviceArea: null,
      deliveryZone: null,
      fulfillmentEligibility: { eligible: count > 0, candidateCount: count },
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

  // Location pins and operating capabilities own assignment; courier quotations own route coverage.
  const [marketRows, locations, capabilities] = await database.batch([
    marketQuery,
    locationsQuery,
    capabilitiesQuery,
  ]);
  const market = marketRows[0] ?? null;
  return evaluateServiceability(
    request,
    {
      market,
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
