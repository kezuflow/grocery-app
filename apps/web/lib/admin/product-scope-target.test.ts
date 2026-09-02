import { describe, expect, it } from "vitest";
import {
  ADMIN_PRODUCT_SCOPE_TARGET_COOKIE,
  parseAdminProductScopeTargetCookie,
  resolveAdminProductScopeTarget,
  serializeAdminProductScopeTarget,
} from "./product-scope-target";

describe("Admin Product scope target", () => {
  it("preserves only explicit Global and Location selections", () => {
    expect(resolveAdminProductScopeTarget({ kind: "GLOBAL" })).toEqual({ kind: "GLOBAL" });
    expect(
      resolveAdminProductScopeTarget({
        kind: "LOCATION",
        marketId: "market-cebu",
        locationId: "cebu-central",
      }),
    ).toEqual({ kind: "LOCATION", marketId: "market-cebu", locationId: "cebu-central" });
    expect(resolveAdminProductScopeTarget({ kind: "MARKET", marketId: "market-cebu" })).toBeNull();
  });

  it("round-trips bounded scope hints and rejects malformed values", () => {
    const target = {
      kind: "LOCATION" as const,
      marketId: "market-cebu",
      locationId: "cebu-central",
    };
    const cookie = `${ADMIN_PRODUCT_SCOPE_TARGET_COOKIE}=${serializeAdminProductScopeTarget(target)}`;
    expect(parseAdminProductScopeTargetCookie(`another=1; ${cookie}; final=2`)).toEqual(target);
    expect(
      parseAdminProductScopeTargetCookie(`${ADMIN_PRODUCT_SCOPE_TARGET_COOKIE}=bad`),
    ).toBeNull();
    expect(
      parseAdminProductScopeTargetCookie(
        `${ADMIN_PRODUCT_SCOPE_TARGET_COOKIE}=${encodeURIComponent(JSON.stringify({ kind: "LOCATION", marketId: "", locationId: "" }))}`,
      ),
    ).toBeNull();
  });
});
