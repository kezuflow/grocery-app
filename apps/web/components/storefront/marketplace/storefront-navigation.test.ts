import { describe, expect, it } from "vitest";
import { storefrontNavigation } from "./storefront-navigation";

describe("storefront navigation metadata", () => {
  it("keeps unavailable departments non-navigable", () => {
    const disabled = storefrontNavigation.filter((item) => item.disabled);
    expect(disabled.map((item) => item.label)).toEqual(["Health", "Alcohol"]);
    for (const item of disabled) expect(item.href).toBeUndefined();
  });
  it("keeps only the original navigation and the requested departments", () => {
    expect(storefrontNavigation.map((item) => item.label)).toEqual([
      "Home",
      "All groceries",
      "Retail",
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
