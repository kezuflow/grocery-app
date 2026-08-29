import { describe, expect, it } from "vitest";
import {
  deliveryJobTransitions,
  fulfillmentTransitions,
  orderTransitions,
  transition,
} from "./state-machines";

describe("commerce state machines", () => {
  it("allows legal commitment progression", () => {
    expect(transition("COMMITTED", "IN_FULFILLMENT", orderTransitions)).toBe("IN_FULFILLMENT");
    expect(transition("ARRIVED", "DELIVERED", deliveryJobTransitions)).toBe("DELIVERED");
  });

  it("enumerates the canonical fulfillment transitions", () => {
    expect(fulfillmentTransitions).toEqual({
      NOT_STARTED: ["PICKING"],
      PICKING: ["READY_TO_PACK", "SHORTED"],
      READY_TO_PACK: ["PACKING", "SHORTED"],
      PACKING: ["PACKED", "SHORTED"],
      PACKED: ["HANDED_OFF"],
      HANDED_OFF: ["COMPLETED"],
      SHORTED: ["PICKING", "READY_TO_PACK", "CANCELED", "ESCALATED"],
    });
    expect(() => transition("COMPLETED", "PICKING", fulfillmentTransitions)).toThrow(
      "ILLEGAL_TRANSITION",
    );
  });

  it("enumerates the canonical delivery-job transitions", () => {
    expect(deliveryJobTransitions).toEqual({
      UNASSIGNED: ["ASSIGNED"],
      ASSIGNED: ["EN_ROUTE"],
      EN_ROUTE: ["ARRIVED"],
      ARRIVED: ["DELIVERED", "FAILED"],
      FAILED: ["RETRY_SCHEDULED", "ESCALATED", "CANCELED"],
      RETRY_SCHEDULED: ["ASSIGNED"],
    });
    expect(() => transition("UNASSIGNED", "DELIVERED", deliveryJobTransitions)).toThrow(
      "ILLEGAL_TRANSITION",
    );
  });

  it("rejects arbitrary state mutation", () => {
    expect(() => transition("COMMITTED", "DELIVERED", orderTransitions)).toThrow(
      "ILLEGAL_TRANSITION",
    );
  });
});
