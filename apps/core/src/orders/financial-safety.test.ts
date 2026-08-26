import { describe, expect, it } from "vitest";
import { financialOperationDisposition } from "./financial-safety";

describe("financialOperationDisposition", () => {
  it("routes every refund to canonical orchestration", () => {
    for (const orderStatus of [
      "COMMITTED",
      "IN_FULFILLMENT",
      "PACKED",
      "DISPATCHED",
      "DELIVERED",
    ]) {
      expect(financialOperationDisposition("REFUND", orderStatus)).toBe(
        "REQUIRES_CANONICAL_ORCHESTRATION",
      );
    }
  });

  it("blocks cancellation of paid committed orders", () => {
    for (const orderStatus of [
      "COMMITTED",
      "IN_FULFILLMENT",
      "PACKED",
      "DISPATCHED",
      "DELIVERED",
    ]) {
      expect(financialOperationDisposition("CANCEL", orderStatus)).toBe(
        "REQUIRES_CANONICAL_ORCHESTRATION",
      );
    }
  });

  it("still permits compatibility cancellation before commitment", () => {
    expect(financialOperationDisposition("CANCEL", "PENDING")).toBe("COMPATIBILITY_ALLOWED");
  });
});
