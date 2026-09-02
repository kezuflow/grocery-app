import { describe, expect, it } from "vitest";
import type { ServiceabilityRequest } from "@freshmarkets/contracts";
import { evaluateServiceability, type GeographyDataset } from "./serviceability";

const request = (latitude: number, longitude: number): ServiceabilityRequest => ({
  requestId: "request",
  latitude,
  longitude,
});

const polygon = (west: number, south: number, east: number, north: number) =>
  JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
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
        id: "area",
        code: "CEBU_CITY",
        name: "Cebu City",
        polygonGeoJson: polygon(123, 10, 124, 11),
        polygonVersion: 2,
        active: true,
      },
    ],
    deliveryZones: [
      {
        id: "zone",
        serviceAreaId: "area",
        code: "CORE",
        name: "Core",
        polygonGeoJson: polygon(123.1, 10.1, 123.9, 10.9),
        polygonVersion: 3,
        active: true,
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
  it("rejects malformed coordinates", () => {
    const result = evaluateServiceability(request(100, 123), dataset());
    expect(result.ok && result.value.reason).toBe("INVALID_COORDINATES");
  });

  it("resolves an inside point, zone versions, and preferred location priority", () => {
    const result = evaluateServiceability(request(10.5, 123.5), dataset());
    expect(result.ok && result.value.serviceable).toBe(true);
    if (!result.ok) return;
    expect(result.value.serviceArea?.polygonVersion).toBe(2);
    expect(result.value.deliveryZone?.polygonVersion).toBe(3);
    expect(result.value.fulfillmentEligibility).toEqual({ eligible: true, candidateCount: 2 });
  });

  it("reports a stale prior polygon resolution", () => {
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

  it("distinguishes outside service area from outside delivery zone", () => {
    const outsideArea = evaluateServiceability(request(12, 125), dataset());
    const outsideZone = evaluateServiceability(request(10.05, 123.05), dataset());
    expect(outsideArea.ok && outsideArea.value.reason).toBe("OUTSIDE_SERVICE_AREA");
    expect(outsideZone.ok && outsideZone.value.reason).toBe("OUTSIDE_DELIVERY_ZONE");
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
    const result = evaluateServiceability(
      request(10.5, 123.5),
      dataset({ market: null, serviceAreas: [] }),
    );
    expect(result.ok && result.value.reason).toBe("OUTSIDE_SERVICE_AREA");
  });

  it("ignores an inactive service area", () => {
    const inactiveArea = dataset().serviceAreas.map((area) => ({ ...area, active: false }));
    const result = evaluateServiceability(
      request(10.5, 123.5),
      dataset({ serviceAreas: inactiveArea }),
    );
    expect(result.ok && result.value.reason).toBe("OUTSIDE_SERVICE_AREA");
  });
});
