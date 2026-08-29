import { describe, expect, it } from "vitest";
import type { PresentationProduct } from "./catalog-presentation";
import { appendUniqueProducts, loadMoreAnnouncement } from "./storefront-pagination";

function presentationItem(id: string, name: string): PresentationProduct {
  return {
    id,
    slug: id.replace(/^p-/, ""),
    name,
    description: null,
    categoryName: "Vegetables",
    categorySlug: "vegetables",
    available: true,
    media: { src: "/produce/potato.webp", alt: "Potatoes" },
    details: [],
    defaultVariant: null,
    variants: [],
  };
}

describe("appendUniqueProducts", () => {
  it("appends a following cursor page without duplicating known ids", () => {
    const first = [
      presentationItem("p-potato", "Potatoes"),
      presentationItem("p-radish", "Radish"),
    ];
    const second = [presentationItem("p-radish", "Radish"), presentationItem("p-squash", "Squash")];
    const merged = appendUniqueProducts(first, second);
    expect(merged.map((item) => item.id)).toEqual(["p-potato", "p-radish", "p-squash"]);
  });

  it("keeps order stable across repeated loads", () => {
    const base = [presentationItem("p-a", "A")];
    const extra = [presentationItem("p-c", "C"), presentationItem("p-b", "B")];
    expect(appendUniqueProducts(appendUniqueProducts(base, extra), []).map((i) => i.id)).toEqual([
      "p-a",
      "p-c",
      "p-b",
    ]);
  });
});

describe("loadMoreAnnouncement", () => {
  it("describes how many products were added and the running total", () => {
    expect(loadMoreAnnouncement({ added: 6, totalShown: 30 })).toBe(
      "Loaded 6 more products. Showing 30 in total.",
    );
  });

  it("handles empty follow-up pages", () => {
    expect(loadMoreAnnouncement({ added: 0, totalShown: 24 })).toBe(
      "No more products were added. Showing 24 in total.",
    );
  });
});
