import { describe, expect, it } from "vitest";
import { decideOrderCancellation } from "./cancellation-policy";
import { orderLifecycleStates } from "./order-state-machine";

const now = Date.parse("2026-09-01T00:00:00.000Z");
const base = {
  actor: "CUSTOMER" as const,
  cause: "CUSTOMER_REQUEST" as const,
  mode: "INSTANT" as const,
  orderState: "COMMITTED" as const,
  serviceFeeMinor: 2_500,
  grossPaidMinor: 100_000,
  now,
  cutoffAt: null,
};

describe("order cancellation policy", () => {
  it("retains only the Instant Service Fee for a customer before fulfillment", () => {
    expect(decideOrderCancellation(base)).toEqual({
      allowed: true,
      retainedServiceFeeMinor: 2_500,
      refundMinor: 97_500,
    });
    expect(decideOrderCancellation({ ...base, serviceFeeMinor: 0 })).toMatchObject({
      allowed: true,
      refundMinor: 100_000,
    });
  });

  it("locks customer cancellation when fulfillment starts", () => {
    expect(decideOrderCancellation({ ...base, orderState: "FULFILLMENT_PENDING" })).toMatchObject({
      allowed: false,
      code: "CANCELLATION_WINDOW_CLOSED",
    });
  });

  it("locks Scheduled cancellation at cutoff equality and requires cutoff evidence", () => {
    const scheduled = { ...base, mode: "SCHEDULED" as const, serviceFeeMinor: 0 };
    expect(decideOrderCancellation({ ...scheduled, cutoffAt: now + 1 })).toMatchObject({
      allowed: true,
      refundMinor: 100_000,
    });
    expect(decideOrderCancellation({ ...scheduled, cutoffAt: now })).toMatchObject({
      allowed: false,
      code: "CANCELLATION_WINDOW_CLOSED",
    });
    expect(decideOrderCancellation({ ...scheduled, cutoffAt: null })).toMatchObject({
      allowed: false,
      code: "CUTOFF_EVIDENCE_MISSING",
    });
  });

  it("returns a full refund for a FreshMarkets-caused cancellation after the customer lock", () => {
    expect(
      decideOrderCancellation({
        ...base,
        actor: "BUSINESS",
        cause: "STOCK_UNAVAILABLE",
        orderState: "FULFILLMENT_PENDING",
      }),
    ).toEqual({ allowed: true, retainedServiceFeeMinor: 0, refundMinor: 100_000 });
  });

  it("rejects unsafe money and every non-cancelable customer state", () => {
    expect(decideOrderCancellation({ ...base, serviceFeeMinor: 100_001 })).toMatchObject({
      allowed: false,
      code: "ORDER_NOT_CANCELABLE",
    });
    for (const orderState of orderLifecycleStates.filter((state) => state !== "COMMITTED")) {
      expect(decideOrderCancellation({ ...base, orderState })).toMatchObject({ allowed: false });
    }
  });
});
