import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
  getMarketplaceHome,
  getProduct,
  searchCatalog,
} from "./service";

type Database = Parameters<typeof getProduct>[0];
const db = () => env.DB as unknown as Database;

const ABIU_MEDIA_JSON =
  '{"version":1,"assetKey":"abiu.webp","altText":"Abiu — fresh market produce photo"}';

async function eligibleCount(categorySlug?: string): Promise<number> {
  const base = `SELECT COUNT(*) AS count FROM product p JOIN category c ON c.id = p.category_id
     WHERE p.status='active' AND c.status='active'
       AND EXISTS (
         SELECT 1 FROM sku s2
         JOIN sku_location_availability sla ON sla.sku_id = s2.id
           AND sla.location_id = 'location-cebu-central'
           AND sla.availability_status = 'AVAILABLE'
         JOIN price_version pv ON pv.sku_id = s2.id
           AND pv.market_id = 'market-metro-cebu'
           AND pv.price_type = 'STANDARD' AND pv.amount_minor > 0 AND pv.valid_to IS NULL
         WHERE s2.product_id = p.id AND s2.status = 'active'
       )`;
  const query = categorySlug ? `${base} AND c.slug = ?1` : base;
  const bound = categorySlug ? env.DB.prepare(query).bind(categorySlug) : env.DB.prepare(query);
  const row = await bound.first<{ count: number }>();
  return row?.count ?? 0;
}

describe("catalog read models (integration)", () => {
  it("paginates the full catalog with stable cursors and no duplicates", async () => {
    let cursor: string | null = null;
    const ids: string[] = [];
    let pages = 0;
    do {
      const page = await searchCatalog(db(), { limit: 24, cursor: cursor ?? undefined });
      expect(page.items.length).toBeLessThanOrEqual(24);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(30);
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(await eligibleCount());
    expect(ids.length).toBeGreaterThan(200);
  });

  it("filters by category before pagination", async () => {
    let cursor: string | null = null;
    const slugs = new Set<string>();
    const ids: string[] = [];
    do {
      const page = await searchCatalog(db(), {
        categorySlug: "fruits",
        limit: 10,
        cursor: cursor ?? undefined,
      });
      for (const item of page.items) {
        slugs.add(item.category.slug);
        ids.push(item.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect([...slugs]).toEqual(["fruits"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(await eligibleCount("fruits"));
    // More than one page of ten proves the filter applied before the limit.
    expect(ids.length).toBeGreaterThan(10);
  });

  it("matches common and local names case-insensitively", async () => {
    const results = await searchCatalog(db(), { query: "sibuyas tagalog", limit: 50 });
    expect(results.items.some((item) => item.slug === "onion-red-shallot-sibuyas-tagalog")).toBe(
      true,
    );
    const chili = await searchCatalog(db(), { query: "SILING LABUYO", limit: 50 });
    expect(chili.items.map((item) => item.slug)).toContain("chili-pepper-fruit-siling-labuyo");
  });

  it("rejects malformed cursors with a typed validation error", async () => {
    await expect(searchCatalog(db(), { cursor: "@@not-a-cursor@@" })).rejects.toMatchObject({
      name: "CatalogValidationError",
      code: "VALIDATION_FAILED",
    });
  });

  it("round-trips cursor payloads through the codec", async () => {
    const encoded = encodeCatalogCursor({
      categorySortOrder: 3,
      productName: "Mangoes",
      productId: "product-mango",
    });
    expect(decodeCatalogCursor(encoded)).toEqual({
      categorySortOrder: 3,
      productName: "Mangoes",
      productId: "product-mango",
    });
    expect(() => decodeCatalogCursor("@@not-a-cursor@@")).toThrowError(
      /cursor/i,
    );
  });

  it("excludes unavailable SKUs from sellable results but keeps detail visible", async () => {
    await env.DB.prepare(
      "UPDATE sku_location_availability SET availability_status='UNAVAILABLE' WHERE sku_id IN (SELECT id FROM sku WHERE product_id=(SELECT id FROM product WHERE slug='durian'))",
    ).run();
    try {
      const listed = await searchCatalog(db(), { query: "durian", limit: 50 });
      expect(listed.items.map((item) => item.slug)).not.toContain("durian");

      const detail = await getProduct(db(), "durian");
      expect(detail?.product.available).toBe(false);
      // Its priced variant data stays intact for honest detail rendering.
      expect(detail?.product.variants.every((variant) => variant.priceMinor !== null)).toBe(true);
    } finally {
      await env.DB.prepare(
        "UPDATE sku_location_availability SET availability_status='AVAILABLE' WHERE sku_id IN (SELECT id FROM sku WHERE product_id=(SELECT id FROM product WHERE slug='durian'))",
      ).run();
    }
  });

  it("never exposes operations packing instructions publicly", async () => {
    const view = await getProduct(db(), "chili-pepper-fruit-siling-labuyo");
    expect(view).toBeTruthy();
    const serialized = JSON.stringify(view);
    expect(serialized).toContain("Approximately 10–15 chili peppers per pack.");
    expect(serialized).not.toContain("Pack 100 g per bag.");
    expect(serialized.toLowerCase()).not.toContain("packinginstruction");
    expect(view?.product.variants[0]?.merchandisingLabel).toBe("Pack");
    expect(view?.product.variants[0]?.sellUnitCode).toBe("G");
    expect(view?.product.media?.src).toBe("/produce/chili-pepper-fruit-siling-labuyo.webp");
    expect(view?.product.details.map((detail) => detail.label)).toEqual(
      expect.arrayContaining(["Contents", "Storage"]),
    );
    expect(view?.product.available).toBe(true);
  });

  it("returns fixed weight variants for staples", async () => {
    const potato = await getProduct(db(), "potato");
    expect(potato?.product.variants.map((variant) => variant.name)).toEqual([
      "250 g",
      "500 g",
      "1 kg",
    ]);
    const onion = await getProduct(db(), "red-onion");
    expect(onion?.product.variants.map((variant) => variant.name)).toEqual(["500 g", "1 kg"]);
    for (const price of potato?.product.variants.map((v) => v.priceMinor ?? 0) ?? [])
      expect(price).toBeGreaterThan(0);
    // Reused SKUs surfaced version 2 pricing with their peso values intact.
    expect(onion?.product.variants[0]?.priceMinor).toBe(12900);
  });

  it("bounds home rails without materializing the whole catalog", async () => {
    const home = await getMarketplaceHome(db(), { itemsPerRail: 8 });
    expect(home.categories.length).toBeGreaterThanOrEqual(7);
    const itemCount = home.rails.reduce((sum, rail) => sum + rail.items.length, 0);
    expect(itemCount).toBeGreaterThan(20);
    expect(itemCount).toBeLessThanOrEqual(home.categories.length * 12);
    for (const rail of home.rails) {
      expect(rail.items.length).toBeGreaterThan(0);
      expect(rail.items.length).toBeLessThanOrEqual(8);
      for (const product of rail.items) {
        expect(product.media?.src).toBeTruthy();
        expect(product.variants.some((variant) => variant.priceMinor !== null)).toBe(true);
      }
    }
  });

  it("returns null for unknown slugs and hides inactive products", async () => {
    expect(await getProduct(db(), "no-such-produce-slug")).toBeNull();

    await env.DB.prepare("UPDATE product SET status='inactive' WHERE slug='rambutan'").run();
    try {
      const listed = await searchCatalog(db(), { query: "rambutan", limit: 50 });
      expect(listed.items.map((item) => item.slug)).not.toContain("rambutan");
      expect(await getProduct(db(), "rambutan")).toBeNull();
    } finally {
      await env.DB.prepare("UPDATE product SET status='active' WHERE slug='rambutan'").run();
    }
  });

  it("falls back to null media for invalid stored media payloads", async () => {
    await env.DB.prepare("UPDATE product SET image_metadata_json='{ broken json' WHERE slug='abiu'").run();
    try {
      const listed = await searchCatalog(db(), { query: "abiu", limit: 50 });
      const abiu = listed.items.find((item) => item.slug === "abiu");
      expect(abiu).toBeTruthy();
      expect(abiu?.media ?? null).toBeNull();
      // The product remains sellable; presentation renders the placeholder.
      expect(abiu?.available).toBe(true);

      const detail = await getProduct(db(), "abiu");
      expect(detail?.product.media ?? null).toBeNull();
    } finally {
      await env.DB.prepare("UPDATE product SET image_metadata_json=? WHERE slug='abiu'")
        .bind(ABIU_MEDIA_JSON)
        .run();
    }
  });
});
