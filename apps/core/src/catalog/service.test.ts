import { describe, expect, it } from "vitest";
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
  MAX_ITEMS_PER_RAIL,
  parseProduceMedia,
} from "./service";

describe("catalog cursor codec", () => {
  it("round-trips payloads as opaque base64url JSON", () => {
    const encoded = encodeCatalogCursor({
      categorySortOrder: 4,
      productName: "Roots, Tubers & Bulbs row",
      productId: "product-zucchini",
    });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("=");

    const payload = JSON.parse(
      Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    // The wire format intentionally exposes only stable ordering fields.
    expect(Object.keys(payload)).toEqual(["c", "n", "p"]);
    expect(payload.p).toBe("product-zucchini");

    expect(decodeCatalogCursor(encoded)).toEqual({
      categorySortOrder: 4,
      productName: "Roots, Tubers & Bulbs row",
      productId: "product-zucchini",
    });
  });

  it("rejects malformed cursors with a typed validation failure", () => {
    for (const bad of ["", "@@nope@@", "a".repeat(600), "e30"]) {
      expect(() => decodeCatalogCursor(bad)).toThrowError(/cursor/i);
    }
  });
});

describe("produce media compatibility parser", () => {
  it("accepts canonical v1 records and returns public asset paths", () => {
    const media = parseProduceMedia(
      JSON.stringify({ version: 1, assetKey: "mango-carabao.webp", altText: "Carabao mangoes" }),
    );
    expect(media).toEqual({ src: "/produce/mango-carabao.webp", alt: "Carabao mangoes" });
  });

  it("rejects broken JSON, wrong versions, traversal, and unsafe keys", () => {
    for (const raw of [
      "{ broken",
      JSON.stringify({ version: 2, assetKey: "x.webp", altText: "later" }),
      JSON.stringify({ version: 1, assetKey: "../secret.webp", altText: "traversal" }),
      JSON.stringify({ version: 1, assetKey: "nested/evil.webp", altText: "slash" }),
      JSON.stringify({ version: 1, assetKey: "photo.png", altText: "wrong suffix" }),
      JSON.stringify({ version: 1, assetKey: "ok.webp", altText: "" }),
      null,
    ]) {
      expect(parseProduceMedia(raw)).toBeNull();
    }
  });

  it("caps home rails at twelve items per rail", () => {
    expect(MAX_ITEMS_PER_RAIL).toBe(12);
  });
});
