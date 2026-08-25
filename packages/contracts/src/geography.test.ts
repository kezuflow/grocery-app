import { describe, expect, it } from "vitest";
import type { ServiceabilityResult } from "./index";

describe("geography contracts", () => {
  it("keeps serviceability as a purpose-built result", () => {
    const result: ServiceabilityResult = {
      serviceable: false,
      reason: "OUTSIDE_SERVICE_AREA",
      coordinate: { latitude: 10, longitude: 123 },
      market: null,
      serviceArea: null,
      deliveryZone: null,
      fulfillmentEligibility: { eligible: false, candidateCount: 0 },
      resolutionChanged: false,
      evaluatedAt: new Date(0).toISOString(),
    };

    expect(result).not.toHaveProperty("polygonGeoJson");
    expect(result).not.toHaveProperty("databaseRow");
  });
});
