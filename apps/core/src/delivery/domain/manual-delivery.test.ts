import { describe, expect, it } from "vitest";
import { manualDeliveryActions } from "./manual-delivery";

describe("manual fallback after a closed attempt", () => {
  const facts = {
    mode: "SCHEDULED",
    jobStatus: "FAILED",
    orderStatus: "FULFILLMENT_READY",
    fulfillmentStatus: "PACKED",
    pendingCancellation: false,
    attempt: { method: "EXTERNAL", status: "CANCELED", handedOverAt: null },
  };
  it.each(["CANCELED", "FAILED"])(
    "allows a definitely closed %s attempt before handover",
    (status) => {
      expect(manualDeliveryActions({ ...facts, attempt: { ...facts.attempt, status } })).toEqual([
        "ASSIGN",
      ]);
    },
  );
  it.each([
    "ACTIVE",
    "PENDING",
    "CREATING",
    "OUTCOME_UNKNOWN",
    "RECONCILIATION_REQUIRED",
    "RETURNED",
    "COMPLETED",
  ])("blocks %s attempts", (status) => {
    expect(manualDeliveryActions({ ...facts, attempt: { ...facts.attempt, status } })).toEqual([]);
  });
  it("rejects pending cancellation, Instant, and evidence that goods left", () => {
    expect(manualDeliveryActions({ ...facts, pendingCancellation: true })).toEqual([]);
    expect(manualDeliveryActions({ ...facts, mode: "INSTANT" })).toEqual([]);
    expect(
      manualDeliveryActions({ ...facts, attempt: { ...facts.attempt, handedOverAt: 1 } }),
    ).toEqual([]);
    expect(manualDeliveryActions({ ...facts, orderStatus: "OUT_FOR_DELIVERY" })).toEqual([]);
    expect(manualDeliveryActions({ ...facts, fulfillmentStatus: "HANDED_OFF" })).toEqual([]);
  });
});
