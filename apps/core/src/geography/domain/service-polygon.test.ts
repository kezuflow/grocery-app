import { describe, it, expect } from "vitest";
import { servicePolygon, polygonWithin } from "./service-polygon";
const vertices = (points: readonly (readonly [number, number])[]) =>
  points.map(([longitude, latitude]) => ({ longitude, latitude }));
describe("service polygon authoring", () => {
  it("rejects degenerate, repeated, out-of-bounds and intersecting polygons", () => {
    for (const points of [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 0],
      ],
      [
        [0, 0],
        [181, 1],
        [0, 1],
      ],
    ] as const)
      expect(servicePolygon(vertices(points))).toBeNull();
  });
  it("permits shared boundaries but rejects a zone edge crossing a concavity", () => {
    const area = servicePolygon(
      vertices([
        [0, 0],
        [4, 0],
        [4, 4],
        [3, 4],
        [3, 1],
        [1, 1],
        [1, 4],
        [0, 4],
      ]),
    );
    const crossing = servicePolygon(
      vertices([
        [0.5, 3],
        [3.5, 3],
        [2, 0.5],
      ]),
    );
    if (!area || !crossing) throw new Error("Expected simple rings");
    expect(polygonWithin(area, area)).toBe(true);
    expect(polygonWithin(crossing, area)).toBe(false);
    const inside = servicePolygon(
      vertices([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    );
    if (!inside) throw new Error("Expected rectangle");
    expect(polygonWithin(inside, area)).toBe(true);
  });
});
