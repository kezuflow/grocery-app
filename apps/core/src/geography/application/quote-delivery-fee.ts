import type { Coordinates, RouteDistancePort } from "../ports/route-distance";
import { calculateDeliveryFee } from "../domain/delivery-fee";

export class DeliveryFeeConfigurationError extends Error {
  readonly code = "DELIVERY_FEE_CONFIGURATION_MISSING";

  constructor() {
    super("DELIVERY_FEE_CONFIGURATION_MISSING");
    this.name = "DeliveryFeeConfigurationError";
  }
}

export type DeliveryFeeSnapshot = {
  marketId: string;
  locationId: string;
  currency: string;
  distanceMeters: number;
  minimumDeliveryFeeMinor: number;
  perKilometerRateMinor: number;
  calculatedFeeMinor: number;
  configurationVersion: number;
  calculation: { method: "ROAD_ROUTE"; profile: "DRIVING" };
};

export async function quoteDeliveryFee(
  database: D1Database,
  routeDistance: RouteDistancePort,
  input: {
    marketId: string;
    locationId: string;
    origin: Coordinates;
    destination: Coordinates;
    now: number;
  },
): Promise<{ feeMinor: number; snapshot: DeliveryFeeSnapshot }> {
  const configuration = await database
    .prepare(
      `SELECT currency, minimum_delivery_fee_minor, per_kilometer_rate_minor, version
       FROM delivery_fee_configuration
       WHERE market_id=? AND location_id=? AND status='ACTIVE'
         AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
       ORDER BY version DESC LIMIT 1`,
    )
    .bind(input.marketId, input.locationId, input.now, input.now)
    .first<{
      currency: string;
      minimum_delivery_fee_minor: number;
      per_kilometer_rate_minor: number;
      version: number;
    }>();
  if (!configuration) throw new DeliveryFeeConfigurationError();

  const route = await routeDistance.routeDistance({
    origin: input.origin,
    destination: input.destination,
  });
  const feeMinor = calculateDeliveryFee({
    distanceMeters: route.distanceMeters,
    perKilometerRateMinor: configuration.per_kilometer_rate_minor,
    minimumDeliveryFeeMinor: configuration.minimum_delivery_fee_minor,
  });
  return {
    feeMinor,
    snapshot: {
      marketId: input.marketId,
      locationId: input.locationId,
      currency: configuration.currency,
      distanceMeters: route.distanceMeters,
      minimumDeliveryFeeMinor: configuration.minimum_delivery_fee_minor,
      perKilometerRateMinor: configuration.per_kilometer_rate_minor,
      calculatedFeeMinor: feeMinor,
      configurationVersion: configuration.version,
      calculation: route.calculation,
    },
  };
}
