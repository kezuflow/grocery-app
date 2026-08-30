import { describe, expect, it } from "vitest";
import { canTransitionOrder } from "./order-state-machine";

describe("order cancellation transitions", () => {
  it("uses CANCELLATION_REQUESTED until coordinated refunds finish", () => {
    expect(canTransitionOrder("COMMITTED", "CANCELLATION_REQUESTED")).toBe(true);
    expect(canTransitionOrder("CANCELLATION_REQUESTED", "CANCELED")).toBe(true);
    expect(canTransitionOrder("COMMITTED", "CANCELED")).toBe(false);
  });
});
