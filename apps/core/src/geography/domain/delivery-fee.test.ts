import { describe, expect, it } from "vitest";
import { calculateDeliveryFee } from "./delivery-fee";

describe("delivery fee calculation", () => {
  it("uses integer ceiling arithmetic and enforces the configured minimum", () => {
    expect(
      calculateDeliveryFee({
        distanceMeters: 1_001,
        perKilometerRateMinor: 2_500,
        minimumDeliveryFeeMinor: 5_000,
      }),
    ).toBe(5_000);
    expect(
      calculateDeliveryFee({
        distanceMeters: 2_001,
        perKilometerRateMinor: 2_500,
        minimumDeliveryFeeMinor: 5_000,
      }),
    ).toBe(5_003);
  });

  it("rejects non-integer, negative, and unsafe inputs", () => {
    for (const input of [
      { distanceMeters: 1.5, perKilometerRateMinor: 1, minimumDeliveryFeeMinor: 1 },
      { distanceMeters: -1, perKilometerRateMinor: 1, minimumDeliveryFeeMinor: 1 },
      { distanceMeters: 1, perKilometerRateMinor: -1, minimumDeliveryFeeMinor: 1 },
      {
        distanceMeters: Number.MAX_SAFE_INTEGER,
        perKilometerRateMinor: 2,
        minimumDeliveryFeeMinor: 1,
      },
    ]) {
      expect(() => calculateDeliveryFee(input)).toThrow("DELIVERY_FEE_INPUT_INVALID");
    }
  });
});
