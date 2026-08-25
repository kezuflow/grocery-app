import { describe, expect, it } from "vitest";
import { deliveryTransitions, orderTransitions, transition } from "./state-machines";

describe("commerce state machines", () => {
  it("allows legal commitment progression", () => {
    expect(transition("COMMITTED", "IN_FULFILLMENT", orderTransitions)).toBe("IN_FULFILLMENT");
    expect(transition("DISPATCHED", "DELIVERED", deliveryTransitions)).toBe("DELIVERED");
  });

  it("rejects arbitrary state mutation", () => {
    expect(() => transition("COMMITTED", "DELIVERED", orderTransitions)).toThrow(
      "ILLEGAL_TRANSITION",
    );
  });
});
