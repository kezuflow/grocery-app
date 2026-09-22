import { describe, expect, it } from "vitest";
import { manualDeliveryActions } from "./manual-delivery";

describe("staff-selected manual delivery", () => {
  const facts = {
    mode: "SCHEDULED",
    jobStatus: "FAILED",
    orderStatus: "FULFILLMENT_READY",
    fulfillmentStatus: "PACKED",
    pendingCancellation: false,
    retryReady: true,
    deliveryDeadline: 200,
    now: 100,
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
    "COMPLETED",
  ])("blocks %s attempts", (status) => {
    expect(manualDeliveryActions({ ...facts, attempt: { ...facts.attempt, status } })).toEqual([]);
  });
  it("allows either committed mode and blocks unresolved custody or readiness", () => {
    expect(
      manualDeliveryActions({
        ...facts,
        mode: "INSTANT",
        jobStatus: "UNASSIGNED",
        attempt: null,
        retryReady: false,
      }),
    ).toEqual(["ASSIGN"]);
    expect(manualDeliveryActions({ ...facts, pendingCancellation: true })).toEqual([]);
    expect(manualDeliveryActions({ ...facts, retryReady: false })).toEqual([]);
    expect(manualDeliveryActions({ ...facts, orderStatus: "OUT_FOR_DELIVERY" })).toEqual([]);
    expect(manualDeliveryActions({ ...facts, fulfillmentStatus: "HANDED_OFF" })).toEqual([]);
    expect(manualDeliveryActions({ ...facts, deliveryDeadline: 100 })).toEqual([]);
  });
});
