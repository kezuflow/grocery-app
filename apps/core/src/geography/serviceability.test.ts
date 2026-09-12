import { describe, expect, it } from "vitest";
import type { ServiceabilityRequest } from "@freshmarkets/contracts";
import { evaluateServiceability, type GeographyDataset } from "./serviceability";

const request = (latitude: number, longitude: number): ServiceabilityRequest => ({
  requestId: "request",
  latitude,
  longitude,
});

function dataset(overrides: Partial<GeographyDataset> = {}): GeographyDataset {
  return {
    market: {
      id: "market",
      code: "METRO_CEBU",
      name: "Metro Cebu",
      currency: "PHP",
      timezone: "Asia/Manila",
    },
    serviceAreas: [
      {
        code: "CEBU",
        name: "Cebu",
        polygonVersion: 1,
        polygonGeojson: JSON.stringify({
          type: "Polygon",
          coordinates: [
            [
              [123, 9],
              [126, 9],
              [126, 13],
              [123, 13],
              [123, 9],
            ],
          ],
        }),
      },
    ],
    candidates: [
      {
        id: "location-secondary",
        code: "SECONDARY",
        name: "Secondary",
        type: "SATELLITE",
        latitude: 10.8,
        longitude: 123.8,
        capabilities: ["PICKING", "PACKING", "DISPATCH"],
        active: true,
      },
      {
        id: "location-cebu-central",
        code: "CEBU_CENTRAL",
        name: "Central Cebu",
        type: "FULFILLMENT_CENTER",
        latitude: 10.51,
        longitude: 123.51,
        capabilities: ["PICKING", "PACKING", "DISPATCH"],
        active: true,
      },
    ],
    ...overrides,
  };
}

describe("serviceability resolver", () => {
  it("admits a global service area before assigning the closest fulfillment pin", () => {
    const outcome = evaluateServiceability(request(10.5, 123.5), dataset());
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        serviceable: true,
        serviceArea: { code: "CEBU", name: "Cebu", polygonVersion: 1 },
        deliveryZone: null,
        fulfillmentEligibility: { candidateCount: 2 },
      },
    });
  });
  it("rejects a valid coordinate outside every global service area", () => {
    const outcome = evaluateServiceability(
      {
        ...request(14.6, 121),
        previousResolution: {
          serviceAreaCode: "CEBU",
          serviceAreaPolygonVersion: 1,
          deliveryZoneCode: null,
          deliveryZonePolygonVersion: null,
        },
      },
      dataset(),
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        serviceable: false,
        reason: "OUTSIDE_SERVICE_AREA",
        fulfillmentEligibility: { eligible: false, candidateCount: 0 },
        resolutionChanged: true,
      },
    });
  });
  it("rejects malformed coordinates", () => {
    const result = evaluateServiceability(request(100, 123), dataset());
    expect(result.ok && result.value.reason).toBe("INVALID_COORDINATES");
  });

  it("resolves an address to its nearest capable location", () => {
    const result = evaluateServiceability(request(10.5, 123.5), dataset());
    expect(result.ok && result.value.serviceable).toBe(true);
    if (!result.ok) return;
    expect(result.value.serviceArea).toMatchObject({ code: "CEBU", polygonVersion: 1 });
    expect(result.value.deliveryZone).toBeNull();
    expect(result.value.fulfillmentEligibility).toEqual({ eligible: true, candidateCount: 2 });
    expect(result.value.fulfillmentLocation?.id).toBe("location-cebu-central");
  });

  it("reports when a saved address was evaluated against an older global boundary", () => {
    const result = evaluateServiceability(
      {
        ...request(10.5, 123.5),
        previousResolution: {
          serviceAreaCode: "CEBU_CITY",
          serviceAreaPolygonVersion: 1,
          deliveryZoneCode: "CORE",
          deliveryZonePolygonVersion: 2,
        },
      },
      dataset(),
    );
    expect(result.ok && result.value.resolutionChanged).toBe(true);
  });

  it("requires operational location capabilities", () => {
    const result = evaluateServiceability(
      request(10.5, 123.5),
      dataset({
        candidates: [
          {
            id: "location-no-dispatch",
            code: "NO_DISPATCH",
            name: "No Dispatch",
            type: "SATELLITE",
            latitude: 10.5,
            longitude: 123.5,
            capabilities: ["PICKING", "PACKING"],
            active: true,
          },
        ],
      }),
    );
    expect(result.ok && result.value.reason).toBe("NO_ELIGIBLE_LOCATION");
  });

  it("treats missing active geography as unavailable", () => {
    const result = evaluateServiceability(request(10.5, 123.5), dataset({ market: null }));
    expect(result.ok && result.value.reason).toBe("NO_ELIGIBLE_LOCATION");
  });

  it("ignores an inactive fulfillment location", () => {
    const inactive = dataset().candidates.map((candidate) => ({ ...candidate, active: false }));
    const result = evaluateServiceability(request(10.5, 123.5), dataset({ candidates: inactive }));
    expect(result.ok && result.value.reason).toBe("NO_ELIGIBLE_LOCATION");
  });
});
