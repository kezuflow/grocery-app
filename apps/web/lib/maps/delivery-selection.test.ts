import { describe, expect, it } from "vitest";
import type { DeliveryMapPin } from "@freshmarkets/contracts";
import { pinsInsideBounds } from "./delivery-selection";

function pin(
  jobId: string,
  latitude: number | null,
  longitude: number | null,
  selectable = true,
): DeliveryMapPin {
  return {
    jobId,
    orderId: `order-${jobId}`,
    batchId: null,
    coordinate: latitude === null || longitude === null ? null : { latitude, longitude },
    fulfillmentMode: "INSTANT",
    cycleId: null,
    status: "UNASSIGNED",
    rider: null,
    version: 1,
    selection: { selectable, reason: selectable ? null : "Core policy" },
  };
}

const bounds = {
  firstCorner: { latitude: 10, longitude: 120 },
  secondCorner: { latitude: 20, longitude: 130 },
} as const;

describe("pinsInsideBounds", () => {
  it("keeps inside pins and every inclusive edge and corner while excluding outside pins", () => {
    const pins = [
      pin("inside", 15, 125),
      pin("south-west", 10, 120),
      pin("north-west", 20, 120),
      pin("south-east", 10, 130),
      pin("north-east", 20, 130),
      pin("south-edge", 10, 125),
      pin("north-edge", 20, 125),
      pin("west-edge", 15, 120),
      pin("east-edge", 15, 130),
      pin("outside-latitude", 21, 125),
      pin("outside-longitude", 15, 131),
    ];
    expect(pinsInsideBounds(pins, bounds).map(({ jobId }) => jobId)).toEqual([
      "inside",
      "south-west",
      "north-west",
      "south-east",
      "north-east",
      "south-edge",
      "north-edge",
      "west-edge",
      "east-edge",
    ]);
  });

  it("normalizes each axis independently for reversed drag corners", () => {
    expect(
      pinsInsideBounds([pin("inside", 15, 125)], {
        firstCorner: { latitude: 20, longitude: 120 },
        secondCorner: { latitude: 10, longitude: 130 },
      }),
    ).toHaveLength(1);
    expect(
      pinsInsideBounds([pin("inside", 15, 125)], {
        firstCorner: { latitude: 10, longitude: 130 },
        secondCorner: { latitude: 20, longitude: 120 },
      }),
    ).toHaveLength(1);
  });

  it("preserves input order and separate identities at duplicate coordinates", () => {
    const pins = [pin("first", 15, 125), pin("second", 15, 125), pin("third", 16, 126)];
    expect(pinsInsideBounds(pins, bounds).map(({ jobId }) => jobId)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("excludes ineligible, null, non-finite, and out-of-range authoritative coordinates", () => {
    const pins = [
      pin("ineligible", 15, 125, false),
      pin("null", null, null),
      pin("nan", Number.NaN, 125),
      pin("infinity", 15, Number.POSITIVE_INFINITY),
      pin("latitude-range", 91, 125),
      pin("longitude-range", 15, 181),
    ];
    expect(
      pinsInsideBounds(pins, {
        firstCorner: { latitude: -100, longitude: -200 },
        secondCorner: { latitude: 100, longitude: 200 },
      }),
    ).toEqual([]);
  });

  it("does not mutate pins, nested coordinates, selection, or bounds", () => {
    const input = [pin("inside", 15, 125)];
    const original = structuredClone(input);
    const originalBounds = structuredClone(bounds);
    const result = pinsInsideBounds(input, bounds);
    expect(input).toEqual(original);
    expect(bounds).toEqual(originalBounds);
    expect(result).not.toBe(input);
    expect(result[0]).toBe(input[0]);
  });
});
