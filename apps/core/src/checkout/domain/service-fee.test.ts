import { describe, expect, it } from "vitest";

import { calculateServiceFee } from "./service-fee";

describe("FreshMarkets Service Fee", () => {
  it.each([
    {
      feeType: "FLAT" as const,
      flatMinor: 2_500,
      basisPoints: 0,
      baseMinor: 100_000,
      expected: 2_500,
    },
    {
      feeType: "PERCENTAGE" as const,
      flatMinor: 0,
      basisPoints: 350,
      baseMinor: 100_001,
      expected: 3_501,
    },
    {
      feeType: "MIXED" as const,
      flatMinor: 1_500,
      basisPoints: 300,
      baseMinor: 100_000,
      expected: 4_500,
    },
  ])("calculates $feeType with integer centavo ceiling", (input) => {
    expect(calculateServiceFee(input)).toMatchObject({
      baseMinor: input.baseMinor,
      feeMinor: input.expected,
    });
  });

  it("rounds any fractional percentage centavo upward", () => {
    expect(
      calculateServiceFee({
        feeType: "PERCENTAGE",
        flatMinor: 0,
        basisPoints: 1,
        baseMinor: 1,
      }).feeMinor,
    ).toBe(1);
  });

  it("allows a zero base but rejects negative and unsafe monetary values", () => {
    expect(
      calculateServiceFee({
        feeType: "PERCENTAGE",
        flatMinor: 0,
        basisPoints: 350,
        baseMinor: 0,
      }).feeMinor,
    ).toBe(0);
    expect(() =>
      calculateServiceFee({
        feeType: "FLAT",
        flatMinor: 100,
        basisPoints: 0,
        baseMinor: -1,
      }),
    ).toThrow(/baseMinor/);
    expect(() =>
      calculateServiceFee({
        feeType: "FLAT",
        flatMinor: Number.MAX_SAFE_INTEGER + 1,
        basisPoints: 0,
        baseMinor: 1,
      }),
    ).toThrow(/flatMinor/);
  });

  it.each([
    { feeType: "FLAT" as const, flatMinor: 100, basisPoints: 1 },
    { feeType: "PERCENTAGE" as const, flatMinor: 1, basisPoints: 100 },
    { feeType: "MIXED" as const, flatMinor: 0, basisPoints: 100 },
    { feeType: "MIXED" as const, flatMinor: 100, basisPoints: 0 },
  ])("rejects invalid $feeType configuration shapes", (input) => {
    expect(() => calculateServiceFee({ ...input, baseMinor: 10_000 })).toThrow(/configuration/);
  });

  it("rejects a fee total that exceeds safe integer storage", () => {
    expect(() =>
      calculateServiceFee({
        feeType: "MIXED",
        flatMinor: Number.MAX_SAFE_INTEGER,
        basisPoints: 10_000,
        baseMinor: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(/safe integer/);
  });
});
