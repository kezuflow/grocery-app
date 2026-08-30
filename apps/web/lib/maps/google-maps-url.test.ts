import { describe, expect, it } from "vitest";
import { GoogleMapsCoordinateValidationError, googleMapsNavigationUrl } from "./google-maps-url";

describe("googleMapsNavigationUrl", () => {
  it("builds the exact keyless Google Maps driving-navigation URL for one destination", () => {
    const result = googleMapsNavigationUrl({ latitude: 10.3157, longitude: 123.8854 });

    expect(result).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=10.3157%2C123.8854&travelmode=driving&dir_action=navigate",
    );

    const url = new URL(result);
    expect(`${url.origin}${url.pathname}`).toBe("https://www.google.com/maps/dir/");
    expect([...url.searchParams.entries()]).toEqual([
      ["api", "1"],
      ["destination", "10.3157,123.8854"],
      ["travelmode", "driving"],
      ["dir_action", "navigate"],
    ]);
    expect(url.searchParams.has("origin")).toBe(false);
    expect(url.searchParams.has("waypoints")).toBe(false);
  });

  it.each([
    [{ latitude: -90, longitude: -180 }, "-90,-180"],
    [{ latitude: 90, longitude: 180 }, "90,180"],
    [{ latitude: 0, longitude: 0 }, "0,0"],
  ] as const)("accepts the inclusive global coordinate boundary %#", (coordinate, destination) => {
    const url = new URL(googleMapsNavigationUrl(coordinate));
    expect(url.searchParams.get("destination")).toBe(destination);
  });

  it.each([
    { latitude: Number.NaN, longitude: 123.8854 },
    { latitude: Number.POSITIVE_INFINITY, longitude: 123.8854 },
    { latitude: Number.NEGATIVE_INFINITY, longitude: 123.8854 },
    { latitude: 10.3157, longitude: Number.NaN },
    { latitude: 10.3157, longitude: Number.POSITIVE_INFINITY },
    { latitude: 10.3157, longitude: Number.NEGATIVE_INFINITY },
    { latitude: -90.000_001, longitude: 123.8854 },
    { latitude: 90.000_001, longitude: 123.8854 },
    { latitude: 10.3157, longitude: -180.000_001 },
    { latitude: 10.3157, longitude: 180.000_001 },
  ])("rejects an invalid coordinate with a typed validation error %#", (coordinate) => {
    expect(() => googleMapsNavigationUrl(coordinate)).toThrow(GoogleMapsCoordinateValidationError);
  });
});
