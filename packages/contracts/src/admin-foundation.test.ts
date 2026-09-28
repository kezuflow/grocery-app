import { expect, it } from "vitest";
import {
  adminCapabilityCodes,
  adminNavigationScopeKinds,
  adminNavigationSectionCodes,
  isAdminCapability,
} from "./admin-foundation";

it("publishes the closed canonical capability vocabulary", () => {
  expect(adminCapabilityCodes).toContain("customers.read");
  expect(adminCapabilityCodes).toContain("inventory.adjust");
  expect(adminCapabilityCodes).toContain("analytics.read");
  expect(isAdminCapability("staff.manage")).toBe(true);
  expect(isAdminCapability("staff:manage")).toBe(false);
  expect(adminNavigationSectionCodes).toEqual([
    "home",
    "orders",
    "products",
    "customers",
    "discounts",
    "content",
    "analytics",
    "sales_channels",
    "settings",
    "overview",
    "commerce",
    "operations",
    "finance",
    "administration",
  ]);
  expect(adminNavigationScopeKinds).toEqual(["GLOBAL", "MARKET", "LOCATION"]);
});
