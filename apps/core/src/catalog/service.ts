import { and, asc, eq, gt, isNull, lte, like, or } from "drizzle-orm";
import type {
  CatalogProduct,
  CatalogSearchPage,
  CategoryNavigationView,
  MarketplaceProductView,
} from "@freshmarkets/contracts";
import { catalogSchema } from "./schema";

type Database = ReturnType<typeof import("drizzle-orm/d1").drizzle>;

function activeAt(validFrom: Date, validTo: Date | null, now: Date) {
  return validFrom <= now && (!validTo || validTo > now);
}

export async function listCategories(database: Database): Promise<CategoryNavigationView> {
  const rows = await database
    .select()
    .from(catalogSchema.category)
    .where(eq(catalogSchema.category.status, "active"))
    .orderBy(asc(catalogSchema.category.sortOrder));
  return { categories: rows.map((row) => ({ code: row.code, name: row.name, slug: row.slug })) };
}

async function products(database: Database, now: Date, query?: string) {
  const rows = await database
    .select({
      product: catalogSchema.product,
      category: catalogSchema.category,
      pool: catalogSchema.inventoryPool,
    })
    .from(catalogSchema.product)
    .innerJoin(
      catalogSchema.category,
      eq(catalogSchema.category.id, catalogSchema.product.categoryId),
    )
    .innerJoin(
      catalogSchema.inventoryPool,
      eq(catalogSchema.inventoryPool.id, catalogSchema.product.inventoryPoolId),
    )
    .where(
      and(
        eq(catalogSchema.product.status, "active"),
        eq(catalogSchema.category.status, "active"),
        query ? like(catalogSchema.product.name, `%${query}%`) : undefined,
      ),
    );
  return rows;
}

async function productView(
  database: Database,
  row: Awaited<ReturnType<typeof products>>[number],
  now: Date,
  locationId?: string,
): Promise<CatalogProduct | null> {
  const skuRows = await database
    .select({ sku: catalogSchema.sku, unit: catalogSchema.unit })
    .from(catalogSchema.sku)
    .innerJoin(catalogSchema.unit, eq(catalogSchema.unit.id, catalogSchema.sku.sellableUnitId))
    .where(
      and(eq(catalogSchema.sku.productId, row.product.id), eq(catalogSchema.sku.status, "active")),
    )
    .orderBy(asc(catalogSchema.sku.sortOrder));
  const priceRows = skuRows.length
    ? await database
        .select()
        .from(catalogSchema.priceVersion)
        .where(or(...skuRows.map(({ sku }) => eq(catalogSchema.priceVersion.skuId, sku.id))))
        .orderBy(asc(catalogSchema.priceVersion.version))
    : [];
  let available = true;
  if (locationId) {
    const availability = await database
      .select()
      .from(catalogSchema.locationProductAvailability)
      .where(
        and(
          eq(catalogSchema.locationProductAvailability.locationId, locationId),
          eq(catalogSchema.locationProductAvailability.productId, row.product.id),
          lte(catalogSchema.locationProductAvailability.validFrom, now),
          or(
            isNull(catalogSchema.locationProductAvailability.validTo),
            gt(catalogSchema.locationProductAvailability.validTo, now),
          ),
        ),
      )
      .limit(1);
    available = availability[0]?.availabilityStatus === "AVAILABLE";
  }
  return {
    id: row.product.id,
    slug: row.product.slug,
    name: row.product.name,
    description: row.product.description,
    category: { code: row.category.code, name: row.category.name, slug: row.category.slug },
    available,
    sourcingMode: row.pool.sourcingMode,
    variants: skuRows.map(({ sku, unit }) => {
      const versions = priceRows.filter(
        (price) => price.skuId === sku.id && activeAt(price.validFrom, price.validTo, now),
      );
      const price = versions.sort((a, b) => b.version - a.version)[0];
      return {
        id: sku.id,
        code: sku.code,
        name: sku.name,
        unit: unit.symbol,
        consumptionBaseQuantity: sku.consumptionBaseQuantity,
        priceMinor: price?.amountMinor ?? null,
        currency: price?.currency ?? null,
        priceVersion: price?.version ?? null,
      };
    }),
  };
}

export async function searchCatalog(
  database: Database,
  input: { query?: string; limit?: number; locationId?: string },
): Promise<CatalogSearchPage> {
  const now = new Date();
  const rows = await products(database, now, input.query);
  const items = (
    await Promise.all(
      rows
        .slice(0, Math.min(input.limit ?? 24, 50))
        .map((row) => productView(database, row, now, input.locationId)),
    )
  ).filter((item): item is CatalogProduct => Boolean(item));
  return { items, nextCursor: null };
}

export async function getProduct(
  database: Database,
  slug: string,
  locationId?: string,
): Promise<MarketplaceProductView | null> {
  const rows = await products(database, new Date());
  const row = rows.find((candidate) => candidate.product.slug === slug);
  if (!row) return null;
  const product = await productView(database, row, new Date(), locationId);
  return product ? { product, deliveryContext: { locationAware: Boolean(locationId) } } : null;
}
