import { describe, expect, expectTypeOf, it } from "vitest";
import {
  mvpPaymentCommitmentPolicy,
  transitionPayment,
  type PaymentDomainState,
  type PaymentObservationInput,
} from "./payment";

describe("canonical payment transitions", () => {
  it("follows the approved payment attempt machine", () => {
    expect(transitionPayment("INITIATED", "REQUIRES_ACTION")).toBe("REQUIRES_ACTION");
    expect(transitionPayment("INITIATED", "PROCESSING")).toBe("PROCESSING");
    expect(transitionPayment("REQUIRES_ACTION", "PROCESSING")).toBe("PROCESSING");
    expect(transitionPayment("PROCESSING", "SUCCEEDED")).toBe("SUCCEEDED");
    expect(transitionPayment("PROCESSING", "FAILED")).toBe("FAILED");
    expect(transitionPayment("INITIATED", "EXPIRED")).toBe("EXPIRED");
    expect(transitionPayment("SUCCEEDED", "REFUNDED")).toBe("REFUNDED");
    expect(transitionPayment("SUCCEEDED", "PARTIALLY_REFUNDED")).toBe("PARTIALLY_REFUNDED");
    expect(transitionPayment("PARTIALLY_REFUNDED", "REFUNDED")).toBe("REFUNDED");
  });

  it("rejects illegal transitions", () => {
    expect(() => transitionPayment("FAILED", "SUCCEEDED")).toThrow("ILLEGAL_TRANSITION");
    expect(() => transitionPayment("EXPIRED", "PROCESSING")).toThrow("ILLEGAL_TRANSITION");
    expect(() => transitionPayment("PENDING" as never, "SUCCEEDED")).toThrow();
  });
});

describe("mvp payment commitment policy", () => {
  it("treats only canonical SUCCEEDED as sufficient", () => {
    for (const state of [
      "INITIATED",
      "REQUIRES_ACTION",
      "PROCESSING",
      "FAILED",
      "EXPIRED",
    ] as const) {
      expect(mvpPaymentCommitmentPolicy.isSufficient(state)).toBe(false);
    }
    expect(mvpPaymentCommitmentPolicy.isSufficient("SUCCEEDED")).toBe(true);
  });
});

describe("provider observation shape", () => {
  it("carries provider identity and never an application expectedVersion", () => {
    const observation: PaymentObservationInput = {
      provider: "fake",
      providerEventId: "evt_1",
      providerReference: "pay_1",
      observedAt: Date.now(),
      canonicalState: "SUCCEEDED",
      amountMinor: 29900,
      currency: "PHP",
      payloadHash: "abc",
    };
    expect(observation.canonicalState).toBe("SUCCEEDED");
    expectTypeOf<PaymentObservationInput>().not.toHaveProperty("expectedVersion");
    expectTypeOf<PaymentObservationInput["canonicalState"]>().toEqualTypeOf<PaymentDomainState>();
  });
});
