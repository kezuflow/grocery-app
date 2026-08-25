import { describe, expect, it } from "vitest";
import { assertNonNegativeInteger } from "./index";

describe("shared integer conventions", () => {
  it("accepts exact non-negative integers", () => {
    expect(assertNonNegativeInteger(250, "quantity")).toBe(250);
  });

  it("rejects negative and fractional values", () => {
    expect(() => assertNonNegativeInteger(-1, "quantity")).toThrow();
    expect(() => assertNonNegativeInteger(1.5, "quantity")).toThrow();
  });
});
