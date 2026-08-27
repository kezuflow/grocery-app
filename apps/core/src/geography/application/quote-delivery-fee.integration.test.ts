import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { RouteDistancePort } from "../ports/route-distance";
import { quoteDeliveryFee } from "./quote-delivery-fee";

const routeDistance: RouteDistancePort = {
  async routeDistance() {
    return {
      distanceMeters: 2_001,
      calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
    };
  },
};

describe("authoritative delivery fee quote", () => {
  it("uses the active versioned location configuration and returns a provider-neutral snapshot", async () => {
    const now = Date.now();
    await env.DB.prepare("DELETE FROM delivery_fee_configuration").run();
    await env.DB.prepare(
      "INSERT INTO delivery_fee_configuration (id, market_id, location_id, currency, minimum_delivery_fee_minor, per_kilometer_rate_minor, status, version, effective_from, effective_to, created_at, updated_at) VALUES (?, 'market-metro-cebu', 'location-cebu-central', 'PHP', 5000, 2500, 'ACTIVE', 3, ?, NULL, ?, ?)",
    )
      .bind(`fee-${crypto.randomUUID()}`, now - 1_000, now, now)
      .run();

    const result = await quoteDeliveryFee(env.DB, routeDistance, {
      marketId: "market-metro-cebu",
      locationId: "location-cebu-central",
      origin: { latitude: 10.3157, longitude: 123.8854 },
      destination: { latitude: 10.32, longitude: 123.9 },
      now,
    });

    expect(result).toEqual({
      feeMinor: 5_003,
      snapshot: {
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
        currency: "PHP",
        distanceMeters: 2_001,
        minimumDeliveryFeeMinor: 5_000,
        perKilometerRateMinor: 2_500,
        calculatedFeeMinor: 5_003,
        configurationVersion: 3,
        calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
      },
    });
  });

  it("fails closed without an active effective configuration", async () => {
    await env.DB.prepare("DELETE FROM delivery_fee_configuration").run();
    await expect(
      quoteDeliveryFee(env.DB, routeDistance, {
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
        origin: { latitude: 10.3157, longitude: 123.8854 },
        destination: { latitude: 10.32, longitude: 123.9 },
        now: 1,
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_FEE_CONFIGURATION_MISSING" });
  });
});
