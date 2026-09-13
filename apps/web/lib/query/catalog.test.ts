import { describe, expect, it } from "vitest";
import { catalogHref, normalizeCatalogSelection } from "./catalog";

describe("catalog URL state", () => {
  it("normalizes blank values and keeps shareable search and category state", () => {
    expect(normalizeCatalogSelection(new URLSearchParams("q=%20apples%20&category=fruit"))).toEqual(
      {
        query: "apples",
        category: "fruit",
      },
    );
    expect(normalizeCatalogSelection(new URLSearchParams("q=%20&category=%20"))).toEqual({
      query: "",
      category: "all",
    });
  });

  it("builds canonical same-path URLs", () => {
    expect(catalogHref({ query: "", category: "all" })).toBe("/");
    expect(catalogHref({ query: "green apple", category: "fruit" })).toBe(
      "/?q=green+apple&category=fruit",
    );
  });
});
