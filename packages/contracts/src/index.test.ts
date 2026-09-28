import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "./index";

describe("phase 0 contracts", () => {
  it("publishes a stable contract version", () => {
    expect(CONTRACT_VERSION).toBe("2026-08-30.cart-reliability");
  });
});
