import { describe, expect, it } from "vitest";
import { storefrontNavigation } from "./storefront-navigation";

describe("storefront navigation metadata", () => {
  it("enables Health and Alcohol availability destinations", () => {
    for (const label of ["Health", "Alcohol"]) {
      const item = storefrontNavigation.find((entry) => entry.label === label);
      expect(item?.disabled).not.toBe(true);
      expect(item?.href).toBe(`/${label.toLowerCase()}`);
    }
  });
  it("keeps only the original navigation and the requested departments", () => {
    expect(storefrontNavigation.map((item) => item.label)).toEqual([
      "Home",
      "All groceries",
      "Retail",
      "Pantry",
      "Meat & Seafood",
      "Health",
      "Alcohol",
      "Deals",
    ]);
    expect(storefrontNavigation.find((item) => item.label === "Retail")?.href).toBe("/retail");
    for (const item of storefrontNavigation.filter((item) => !item.disabled)) {
      expect(item.href).toMatch(/^\//);
      expect(item.icon).toBeDefined();
    }
  });
});
