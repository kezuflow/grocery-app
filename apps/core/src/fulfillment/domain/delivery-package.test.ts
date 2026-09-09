import { describe, expect, it } from "vitest";
import {
  deliveryPackageKind,
  deliveryPackageForLineWeights,
  resolveLineShippingWeightGrams,
  totalShippingWeightGrams,
} from "./delivery-package";

describe("delivery package policy", () => {
  it("uses exact gram consumption for a weighted SKU", () => {
    expect(
      resolveLineShippingWeightGrams({
        baseUnitCode: "GRAM",
        quantity: 100,
        baseQuantity: 5_000,
        estimatedShippingWeightGrams: null,
      }),
    ).toBe(5_000);
  });

  it("multiplies a configured per-piece shipping weight by ordered quantity", () => {
    expect(
      resolveLineShippingWeightGrams({
        baseUnitCode: "PIECE",
        quantity: 12,
        baseQuantity: 12,
        estimatedShippingWeightGrams: 60,
      }),
    ).toBe(720);
  });

  it("does not pretend pieces or milliliters are grams when no estimate exists", () => {
    expect(
      resolveLineShippingWeightGrams({
        baseUnitCode: "PIECE",
        quantity: 12,
        baseQuantity: 12,
        estimatedShippingWeightGrams: null,
      }),
    ).toBeNull();
  });

  it("uses one bag below 10 kg and one box from 10 kg", () => {
    expect(deliveryPackageKind(9_999)).toBe("BAG");
    expect(deliveryPackageKind(10_000)).toBe("BOX");
    expect(deliveryPackageKind(20_000)).toBe("BOX");
    expect(deliveryPackageKind(20_001)).toBeNull();
    expect(deliveryPackageForLineWeights([19_000, 1_001])).toBeNull();
    expect(deliveryPackageKind(0)).toBeNull();
    expect(totalShippingWeightGrams([5_000, 4_999])).toBe(9_999);
    expect(totalShippingWeightGrams([5_000, null])).toBeNull();
    expect(deliveryPackageForLineWeights([6_000, 4_000])).toEqual({
      kind: "BOX",
      quantity: 1,
      weightGrams: 10_000,
    });
  });
});
