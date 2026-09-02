import { describe, expect, it } from "vitest";
import { closestLocation, haversineDistanceMeters, sortLocationsByDistance } from "./geometry";

describe("straight-line fulfillment location assignment", () => {
  it("selects the closest overlapping candidate by exact Haversine distance", () => {
    const customer = { latitude: 10.3157, longitude: 123.8854 };
    const candidates = [
      { id: "location-far", latitude: 10.4, longitude: 123.95 },
      { id: "location-near", latitude: 10.32, longitude: 123.89 },
    ];
    expect(closestLocation(customer, candidates)?.id).toBe("location-near");
    expect(haversineDistanceMeters(customer, candidates[1]!)).toBeLessThan(
      haversineDistanceMeters(customer, candidates[0]!),
    );
  });

  it("uses stable location id ordering for an exact distance tie", () => {
    const customer = { latitude: 10, longitude: 123 };
    const tied = [
      { id: "location-b", latitude: 10.1, longitude: 123 },
      { id: "location-a", latitude: 10.1, longitude: 123 },
    ];
    expect(sortLocationsByDistance(customer, tied).map((location) => location.id)).toEqual([
      "location-a",
      "location-b",
    ]);
  });
});
