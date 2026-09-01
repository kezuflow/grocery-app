import { describe, expect, it } from "vitest";
import type { AdminScopeOptionView } from "@freshmarkets/contracts";
import {
  ADMIN_PRODUCT_PRICING_TARGET_COOKIE,
  parseAdminProductPricingTargetCookie,
  resolveAdminProductPricingTarget,
  serializeAdminProductPricingTarget,
} from "./product-pricing-target";

const scopes = [
  {
    kind: "market",
    marketId: "market-cebu",
    marketCode: "CEBU",
    marketName: "Cebu",
    currency: "PHP",
    timezone: "Asia/Manila",
  },
  {
    kind: "location",
    marketId: "market-cebu",
    marketCode: "CEBU",
    locationId: "cebu-central",
    locationCode: "CEBU_CENTRAL",
    locationName: "Central Cebu",
    currency: "PHP",
    timezone: "Asia/Manila",
  },
] satisfies ReadonlyArray<AdminScopeOptionView>;

describe("Admin Product pricing target", () => {
  it("uses the explicit location or market selection", () => {
    expect(
      resolveAdminProductPricingTarget(
        { kind: "LOCATION", marketId: "market-cebu", locationId: "cebu-central" },
        scopes,
      ),
    ).toEqual({ marketId: "market-cebu", locationId: "cebu-central" });
    expect(
      resolveAdminProductPricingTarget({ kind: "MARKET", marketId: "market-cebu" }, scopes),
    ).toEqual({ marketId: "market-cebu", locationId: null });
  });

  it("uses the first reachable market without silently selecting its location for Global", () => {
    expect(resolveAdminProductPricingTarget({ kind: "GLOBAL" }, scopes)).toEqual({
      marketId: "market-cebu",
      locationId: null,
    });
  });

  it("round-trips a bounded non-authoritative cookie hint and rejects malformed values", () => {
    const target = { marketId: "market-cebu", locationId: "cebu-central" };
    const cookie = `${ADMIN_PRODUCT_PRICING_TARGET_COOKIE}=${serializeAdminProductPricingTarget(target)}`;
    expect(parseAdminProductPricingTargetCookie(`another=1; ${cookie}; final=2`)).toEqual(target);
    expect(parseAdminProductPricingTargetCookie(`${ADMIN_PRODUCT_PRICING_TARGET_COOKIE}=bad`)).toBe(
      null,
    );
    expect(
      parseAdminProductPricingTargetCookie(
        `${ADMIN_PRODUCT_PRICING_TARGET_COOKIE}=${encodeURIComponent(JSON.stringify({ marketId: "", locationId: null }))}`,
      ),
    ).toBe(null);
  });
});
