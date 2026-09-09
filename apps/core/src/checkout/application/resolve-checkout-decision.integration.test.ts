import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resolveCheckoutDecision } from "./resolve-checkout-decision";

function financial(merchandiseSubtotalMinor: number, deliverySubtotalMinor = 0) {
  return {
    merchandiseSubtotalMinor,
    itemDiscountMinor: 0,
    orderDiscountMinor: 0,
    deliverySubtotalMinor,
    deliveryDiscountMinor: 0,
    serviceFeeMinor: 0,
    taxMinor: 0,
    totalMinor: merchandiseSubtotalMinor + deliverySubtotalMinor,
    currency: "PHP",
  };
}

describe("resolveCheckoutDecision", () => {
  it("accepts a small nonempty basket regardless of the retained market minimum", async () => {
    const decision = await resolveCheckoutDecision(env.DB, {
      marketId: "market-metro-cebu",
      financial: financial(1, 0),
      evidence: { mode: "SCHEDULED" as const },
    });

    expect(decision).toMatchObject({
      eligible: true,
      failures: [],
      minimumBasketMinor: null,
      evidence: { mode: "SCHEDULED" },
    });
  });

  it("returns immutable evidence when the financial and market policy agree", async () => {
    const evidence = { mode: "INSTANT" as const, locationId: "location-cebu-central" };

    const decision = await resolveCheckoutDecision(env.DB, {
      marketId: "market-metro-cebu",
      financial: financial(50_000),
      evidence,
    });

    expect(decision).toMatchObject({
      eligible: true,
      failures: [],
      currency: "PHP",
      minimumBasketMinor: null,
      evidence,
    });
    expect(Object.isFrozen(decision.evidence)).toBe(true);
  });

  it("fails closed when the market policy is absent", async () => {
    const decision = await resolveCheckoutDecision(env.DB, {
      marketId: `missing-${crypto.randomUUID()}`,
      financial: financial(100_000),
      evidence: { mode: "SCHEDULED" as const },
    });

    expect(decision).toMatchObject({
      eligible: false,
      failures: ["CONFIGURATION_ERROR"],
      evidence: null,
    });
  });
});
