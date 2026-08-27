import { describe, expect, it } from "vitest";
import { storefrontNavigation } from "./storefront-navigation";

describe("storefront navigation metadata", () => {
  it("defines icon-led shopping destinations with stable routes", () => {
    expect(storefrontNavigation.map((item) => item.label)).toEqual([
      "Home",
      "Produce",
      "Fruits",
      "Meat & Seafood",
      "Dairy & Eggs",
      "Pantry",
      "Bakery",
      "Boxes",
      "Deals",
    ]);

    for (const item of storefrontNavigation) {
      expect(item.href).toMatch(/^\/?(?:\?|$)/);
      expect(item.icon).toBeDefined();
      expect(item.tone).toMatch(/^[a-z-]+$/);
    }
  });
});
