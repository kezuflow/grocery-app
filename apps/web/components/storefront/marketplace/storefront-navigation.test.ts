import { describe, expect, it } from "vitest";
import { storefrontNavigation } from "./storefront-navigation";

describe("storefront navigation metadata", () => {
  it("defines high-level destinations without duplicating product categories", () => {
    expect(storefrontNavigation.map((item) => item.label)).toEqual([
      "Home",
      "All groceries",
      "Deals",
    ]);

    expect(storefrontNavigation.map((item) => item.href)).toEqual([
      "/",
      "/?category=all",
      "/#daily-deals",
    ]);

    for (const item of storefrontNavigation) {
      expect(item.href).toMatch(/^\//);
      expect(item.icon).toBeDefined();
      expect(item.tone).toMatch(/^[a-z-]+$/);
    }
  });
});
