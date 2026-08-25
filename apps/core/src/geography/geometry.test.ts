import { describe, expect, it } from "vitest";
import { parsePolygonGeoJson, pointInPolygon, validCoordinate } from "./geometry";

const square = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
});

describe("geofence geometry", () => {
  it("accepts points inside and on a polygon boundary", () => {
    const polygon = parsePolygonGeoJson(square);
    expect(polygon).not.toBeNull();
    expect(pointInPolygon([5, 5], polygon!)).toBe(true);
    expect(pointInPolygon([0, 5], polygon!)).toBe(true);
  });

  it("rejects points outside and in holes", () => {
    const polygon = parsePolygonGeoJson(
      JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
          [
            [4, 4],
            [6, 4],
            [6, 6],
            [4, 6],
            [4, 4],
          ],
        ],
      }),
    );
    expect(pointInPolygon([20, 20], polygon!)).toBe(false);
    expect(pointInPolygon([5, 5], polygon!)).toBe(false);
  });

  it("rejects malformed polygons and coordinates", () => {
    expect(parsePolygonGeoJson("not-json")).toBeNull();
    expect(parsePolygonGeoJson(JSON.stringify({ type: "Point", coordinates: [0, 0] }))).toBeNull();
    expect(validCoordinate(10, 123)).toBe(true);
    expect(validCoordinate(91, 123)).toBe(false);
    expect(validCoordinate(10, Number.NaN)).toBe(false);
  });
});
