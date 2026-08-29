import type {
  CatalogDetail,
  CatalogMedia,
  CatalogProduct,
  CatalogSearchPage,
  CatalogSellUnitCode,
  CatalogVariant,
  CategoryNavigationView,
  MarketplaceHomeView,
  MarketplaceProductView,
} from "@freshmarkets/contracts";

/**
 * Minimal raw D1 surface used by catalog reads; catalog queries bypass ORM
 * row-mapping to keep pagination, windowed rails, and hydration as explicit
 * purpose-built SQL.
 */
interface CatalogRawStatement {
  bind(...values: unknown[]): {
    all<T>(): Promise<{ results?: T[] }>;
    first<T>(): Promise<T | null>;
  };
}
interface CatalogRawDatabase {
  prepare(query: string): CatalogRawStatement;
}
type Database = CatalogRawDatabase;

/** Launch-scoped commerce constants for the Metro Cebu Scheduled catalog. */
export const MARKET_METRO_CEBU = "market-metro-cebu";
export const LAUNCH_LOCATION_ID = "location-cebu-central";

const DEFAULT_PAGE_LIMIT = 24;
const MAX_PAGE_LIMIT = 50;
export const DEFAULT_ITEMS_PER_RAIL = 8;
export const MAX_ITEMS_PER_RAIL = 12;

/**
 * Typed failure for invalid pagination inputs so the transport maps it to the
 * stable `VALIDATION_FAILED` envelope without leaking internals.
 */
export class CatalogValidationError extends Error {
  readonly code = "VALIDATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "CatalogValidationError";
  }
}

/* ------------------------------------------------------------------ */
/* Cursor codec                                                        */
/* ------------------------------------------------------------------ */

export type CatalogCursorPayload = {
  categorySortOrder: number;
  productName: string;
  productId: string;
};

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCatalogCursor(payload: CatalogCursorPayload): string {
  return base64UrlEncode(
    JSON.stringify({ c: payload.categorySortOrder, n: payload.productName, p: payload.productId }),
  );
}

export function decodeCatalogCursor(cursor: string): CatalogCursorPayload {
  let parsed: unknown;
  try {
    if (!cursor || cursor.length > 512 || /[^A-Za-z0-9_-]/.test(cursor)) throw new Error("shape");
    parsed = JSON.parse(base64UrlDecode(cursor));
  } catch {
    throw new CatalogValidationError("Malformed pagination cursor");
  }
  const record = parsed as Record<string, unknown>;
  const { c: categorySortOrder, n: productName, p: productId } = record as Record<string, unknown>;
  if (
    typeof categorySortOrder !== "number" ||
    !Number.isSafeInteger(categorySortOrder) ||
    categorySortOrder < 0 ||
    typeof productName !== "string" ||
    productName.length === 0 ||
    productName.length > 200 ||
    typeof productId !== "string" ||
    productId.length === 0 ||
    productId.length > 200
  ) {
    throw new CatalogValidationError("Malformed pagination cursor");
  }
  return { categorySortOrder, productName, productId };
}

/* ------------------------------------------------------------------ */
/* Media compatibility parsing                                         */
/* ------------------------------------------------------------------ */

type PublicProduceMediaV1 = { version: 1; assetKey: string; altText: string };

const SAFE_ASSET_KEY = /^[a-z0-9][a-z0-9._-]*\.webp$/i;

/**
 * Validates stored product media before it becomes a public asset path.
 * Malformed or unsafe payloads resolve to null; Web renders its accessible
 * placeholder rather than a guessed broken URL.
 */
export function parseProduceMedia(raw: string | null): CatalogMedia | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const media = parsed as Partial<PublicProduceMediaV1>;
  if (
    media.version !== 1 ||
    typeof media.assetKey !== "string" ||
    typeof media.altText !== "string" ||
    media.assetKey.includes("/") ||
    media.assetKey.includes("\\") ||
    media.assetKey.includes("..") ||
    !SAFE_ASSET_KEY.test(media.assetKey) ||
    media.altText.trim() === ""
  ) {
    return null;
  }
  return { src: `/produce/${media.assetKey}`, alt: media.altText };
}

/* ------------------------------------------------------------------ */
/* Set-based row access                                                */
/* ------------------------------------------------------------------ */

async function rawAll<T>(database: Database, query: string, parameters: unknown[]): Promise<T[]> {
  return (
    (
      await database
        .prepare(query)
        .bind(...parameters)
        .all<T>()
    ).results ?? []
  );
}

function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Eligible-to-sell subquery: an active SKU with Cebu availability and an open
 * positive Metro Cebu STANDARD price. Scheduled visibility never reads
 * physical inventory balances — the Admin availability flag decides display.
 */
function eligibleSkuSubquery(nowMs: number): string {
  return `
    EXISTS (
      SELECT 1
      FROM sku candidate_sku
      JOIN sku_location_availability sla
        ON sla.sku_id = candidate_sku.id
       AND sla.location_id = '${LAUNCH_LOCATION_ID}'
       AND sla.availability_status = 'AVAILABLE'
      JOIN price_version pv
        ON pv.sku_id = candidate_sku.id
       AND pv.market_id = '${MARKET_METRO_CEBU}'
       AND (pv.location_id = '${LAUNCH_LOCATION_ID}' OR pv.location_id IS NULL)
       AND pv.price_type = 'STANDARD'
       AND pv.amount_minor > 0
       AND pv.valid_from <= ${nowMs}
       AND (pv.valid_to IS NULL OR pv.valid_to > ${nowMs})
      WHERE candidate_sku.product_id = p.id
        AND candidate_sku.status = 'active'
    )`;
}

const PRODUCT_SELECT_COLUMNS = `
  p.id AS productId,
  p.slug AS slug,
  p.name AS productName,
  p.description AS description,
  p.image_metadata_json AS imageMetadataJson,
  c.code AS categoryCode,
  c.name AS categoryName,
  c.slug AS categorySlug,
  c.sort_order AS categorySortOrder`;

type ProductListRow = {
  productId: string;
  slug: string;
  productName: string;
  description: string | null;
  imageMetadataJson: string | null;
  categoryCode: string;
  categoryName: string;
  categorySlug: string;
  categorySortOrder: number;
};

async function selectProductRows(
  database: Database,
  options: {
    nowMs: number;
    requireSellable?: boolean;
    categorySlug?: string;
    query?: string;
    cursor?: string;
    limit?: number;
    slug?: string;
  },
): Promise<ProductListRow[]> {
  const conditions: string[] = [`p.status = 'active'`, `c.status = 'active'`];
  const parameters: Array<string | number> = [];

  if (options.slug !== undefined) {
    conditions.push("p.slug = ?");
    parameters.push(options.slug);
  }
  if (options.categorySlug !== undefined) {
    conditions.push("c.slug = ?");
    parameters.push(options.categorySlug);
  }
  if (options.query !== undefined && options.query.trim() !== "") {
    conditions.push(`(p.name LIKE ? ESCAPE '\\' OR p.slug LIKE ? ESCAPE '\\')`);
    const pattern = `%${options.query.trim().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    parameters.push(pattern, pattern);
  }
  if (options.requireSellable) conditions.push(eligibleSkuSubquery(options.nowMs));

  let fetchedLimit = options.limit ?? DEFAULT_PAGE_LIMIT;
  fetchedLimit = Math.max(1, Math.min(Math.floor(fetchedLimit), MAX_PAGE_LIMIT));
  let hasCursor = false;
  if (options.cursor !== undefined) {
    hasCursor = true;
    const payload = decodeCatalogCursor(options.cursor);
    conditions.push(
      `(c.sort_order > ?
        OR (c.sort_order = ? AND p.name > ?)
        OR (c.sort_order = ? AND p.name = ? AND p.id > ?))`,
    );
    parameters.push(
      payload.categorySortOrder,
      payload.categorySortOrder,
      payload.productName,
      payload.categorySortOrder,
      payload.productName,
      payload.productId,
    );
  }
  // One extra row lets callers detect a following page cheaply.
  parameters.push(fetchedLimit + 1);

  const statement = `
    SELECT ${PRODUCT_SELECT_COLUMNS}
    FROM product p
    JOIN category c ON c.id = p.category_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY c.sort_order ASC, p.name ASC, p.id ASC
    LIMIT ?`;

  const rows = await rawAll<ProductListRow>(database, statement, parameters);
  void hasCursor;
  return rows;
}

type SkuRow = {
  id: string;
  product_id: string;
  code: string;
  name: string;
  symbol: string;
  unit_code: string;
  merchandising_label: string | null;
  sell_quantity: number;
  consumption_base_quantity: number;
};

type PriceRow = { sku_id: string; amount_minor: number; currency: string; version: number };

/** Expand page rows into full products through five batched queries. */
async function hydrateProducts(
  database: Database,
  rows: ReadonlyArray<ProductListRow>,
  locationId: string,
  nowMs: number,
): Promise<Map<string, CatalogProduct>> {
  const hydrated = new Map<string, CatalogProduct>();
  if (rows.length === 0) return hydrated;

  const ids = rows.map((row) => row.productId);
  const idList = sqlPlaceholders(ids.length);
  const skuIdList = `(SELECT id FROM sku WHERE product_id IN (${idList}))`;

  const [skuRows, priceRows, availabilityRows, productDetailRows, skuDetailRows] =
    await Promise.all([
      rawAll<SkuRow>(
        database,
        `SELECT s.id, s.product_id, s.code, s.name, u.symbol AS symbol, u.code AS unit_code,
                s.merchandising_label, s.sell_quantity, s.consumption_base_quantity
         FROM sku s JOIN unit u ON u.id = s.sellable_unit_id
         WHERE s.status = 'active' AND s.product_id IN (${idList})
         ORDER BY s.product_id ASC, s.sort_order ASC, s.id ASC`,
        ids,
      ),
      rawAll<PriceRow>(
        database,
        `WITH ranked_prices AS (
           SELECT pv.sku_id, pv.amount_minor, pv.currency, pv.version,
                  ROW_NUMBER() OVER (
                    PARTITION BY pv.sku_id
                    ORDER BY CASE WHEN pv.location_id = ? THEN 0 ELSE 1 END,
                             pv.valid_from DESC, pv.version DESC, pv.id DESC
                  ) AS winner_rank
           FROM price_version pv
           WHERE pv.sku_id IN ${skuIdList}
             AND pv.market_id = '${MARKET_METRO_CEBU}' AND pv.price_type = 'STANDARD'
             AND (pv.location_id = ? OR pv.location_id IS NULL)
             AND pv.amount_minor > 0
             AND pv.valid_from <= ${nowMs}
             AND (pv.valid_to IS NULL OR pv.valid_to > ${nowMs})
         )
         SELECT sku_id, amount_minor, currency, version
         FROM ranked_prices WHERE winner_rank = 1`,
        [locationId, ...ids, locationId],
      ),
      rawAll<{ sku_id: string }>(
        database,
        `SELECT DISTINCT sku_id FROM sku_location_availability
         WHERE location_id = '${locationId}' AND availability_status = 'AVAILABLE'
           AND sku_id IN ${skuIdList}`,
        ids,
      ),
      rawAll<{ product_id: string; label: string; value: string; sortOrder: number }>(
        database,
        `SELECT product_id, label, value, sort_order AS sortOrder
         FROM product_detail WHERE product_id IN (${idList})
         ORDER BY sort_order ASC, label ASC`,
        ids,
      ),
      rawAll<{ sku_id: string; label: string; value: string }>(
        database,
        `SELECT sku_id, label, value FROM sku_detail
         WHERE audience = 'CUSTOMER' AND sku_id IN ${skuIdList}
         ORDER BY sort_order ASC, label ASC`,
        ids,
      ),
    ]);

  const skusByProduct = new Map<string, SkuRow[]>();
  for (const sku of skuRows) {
    const bucket = skusByProduct.get(sku.product_id) ?? [];
    bucket.push(sku);
    skusByProduct.set(sku.product_id, bucket);
  }
  const availableSkuIds = new Set(availabilityRows.map((row) => row.sku_id));
  const detailsByProduct = new Map<string, CatalogDetail[]>();
  for (const detail of productDetailRows) {
    const bucket = detailsByProduct.get(detail.product_id) ?? [];
    bucket.push({ label: detail.label, value: detail.value, sortOrder: detail.sortOrder });
    detailsByProduct.set(detail.product_id, bucket);
  }
  const customerNotesBySku = new Map<string, string>();
  for (const note of skuDetailRows) customerNotesBySku.set(note.sku_id, note.value);
  const pricesBySku = new Map(priceRows.map((price) => [price.sku_id, price]));

  function sellUnitCodeFor(unitCode: string): CatalogSellUnitCode {
    if (unitCode === "KILOGRAM") return "KG";
    if (unitCode === "PIECE") return "PC";
    return "G";
  }

  for (const row of rows) {
    const media = parseProduceMedia(row.imageMetadataJson);
    const variants: CatalogVariant[] = (skusByProduct.get(row.productId) ?? []).map((sku) => {
      const price = pricesBySku.get(sku.id) ?? null;
      return {
        id: sku.id,
        code: sku.code,
        name: sku.name,
        merchandisingLabel: sku.merchandising_label ?? null,
        sellQuantity: sku.sell_quantity,
        sellUnitCode: sellUnitCodeFor(sku.unit_code),
        unit: sku.symbol,
        consumptionBaseQuantity: sku.consumption_base_quantity,
        contentsNote:
          sku.merchandising_label !== null ? (customerNotesBySku.get(sku.id) ?? null) : null,
        priceMinor: price?.amount_minor ?? null,
        currency: price?.currency ?? null,
        priceVersion: price?.version ?? null,
      };
    });
    const anySellableVariant = variants.some(
      (variant) => variant.priceMinor !== null && availableSkuIds.has(variant.id),
    );
    hydrated.set(row.productId, {
      id: row.productId,
      slug: row.slug,
      name: row.productName,
      description: row.description,
      category: {
        code: row.categoryCode,
        name: row.categoryName,
        slug: row.categorySlug,
      },
      media,
      details: detailsByProduct.get(row.productId) ?? [],
      available: anySellableVariant,
      variants,
    });
  }
  return hydrated;
}

/* ------------------------------------------------------------------ */
/* Public read models                                                  */
/* ------------------------------------------------------------------ */

const SAFE_CATEGORY_ICON_ASSET_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/;

export async function listCategories(database: Database): Promise<CategoryNavigationView> {
  const rows = await rawAll<{
    code: string;
    name: string;
    slug: string;
    iconAssetKey: string | null;
  }>(
    database,
    `SELECT code, name, slug, icon_asset_key AS iconAssetKey
       FROM category
      WHERE status = 'active'
      ORDER BY sort_order ASC, id ASC`,
    [],
  );
  return {
    categories: rows.map(({ iconAssetKey, ...category }) => ({
      ...category,
      iconSrc:
        iconAssetKey && SAFE_CATEGORY_ICON_ASSET_KEY.test(iconAssetKey)
          ? `/category-icons/${iconAssetKey}`
          : null,
    })),
  };
}

export async function searchCatalog(
  database: Database,
  input: {
    query?: string;
    categorySlug?: string;
    cursor?: string;
    limit?: number;
    locationId?: string;
  },
): Promise<CatalogSearchPage> {
  const nowMs = Date.now();
  if (input.cursor !== undefined) decodeCatalogCursor(input.cursor); // fail fast

  const requestedLimit = Math.min(Math.max(1, input.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
  const rows = await selectProductRows(database, {
    nowMs,
    requireSellable: true,
    query: input.query,
    categorySlug: input.categorySlug,
    cursor: input.cursor,
    limit: requestedLimit,
  });

  const hasNextPage = rows.length > requestedLimit;
  const pageRows = hasNextPage ? rows.slice(0, -1) : rows;
  const hydrated = await hydrateProducts(
    database,
    pageRows,
    input.locationId ?? LAUNCH_LOCATION_ID,
    nowMs,
  );
  const items = pageRows
    .map((row) => hydrated.get(row.productId))
    .filter((product): product is CatalogProduct => Boolean(product));

  let nextCursor: string | null = null;
  if (hasNextPage && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    if (last) {
      nextCursor = encodeCatalogCursor({
        categorySortOrder: last.categorySortOrder,
        productName: last.productName,
        productId: last.productId,
      });
    }
  }
  return { items, nextCursor };
}

export async function getProduct(
  database: Database,
  slug: string,
  locationId?: string,
): Promise<MarketplaceProductView | null> {
  const nowMs = Date.now();
  // Detail lookup is not availability-filtered: unknown or inactive slugs are
  // NOT_FOUND, but currently unavailabile products still render honestly.
  const rows = await selectProductRows(database, { nowMs, slug, limit: 1 });
  const row = rows[0];
  if (!row || row.slug !== slug) return null;
  const hydrated = await hydrateProducts(database, [row], locationId ?? LAUNCH_LOCATION_ID, nowMs);
  const product = hydrated.get(row.productId);
  if (!product) return null;
  return { product, deliveryContext: { locationAware: Boolean(locationId) } };
}

/**
 * Bounded home discovery: one windowed scan takes at most `itemsPerRail`
 * eligible products per category, then every chosen product is hydrated once
 * through the same batched assembly used by search. Rails never materialize
 * the full catalog.
 */
export async function getMarketplaceHome(
  database: Database,
  input: { locationId?: string; itemsPerRail?: number },
): Promise<MarketplaceHomeView> {
  const nowMs = Date.now();
  const itemsPerRail = Math.min(
    Math.max(1, Math.floor(input.itemsPerRail ?? DEFAULT_ITEMS_PER_RAIL)),
    MAX_ITEMS_PER_RAIL,
  );

  const categories = await listCategories(database);

  const rows = await rawAll<ProductListRow>(
    database,
    `SELECT * FROM (
       SELECT ${PRODUCT_SELECT_COLUMNS}, ROW_NUMBER() OVER (
         PARTITION BY c.id ORDER BY c.sort_order ASC, p.name ASC, p.id ASC
       ) AS rn
       FROM product p
       JOIN category c ON c.id = p.category_id
       WHERE p.status = 'active' AND c.status = 'active'
         AND ${eligibleSkuSubquery(nowMs)}
     )
     WHERE rn <= ?
     ORDER BY categorySortOrder ASC, productName ASC, productId ASC`,
    [itemsPerRail],
  );
  if (rows.length === 0) return { categories: categories.categories, rails: [] };

  const hydrated = await hydrateProducts(
    database,
    rows,
    input.locationId ?? LAUNCH_LOCATION_ID,
    nowMs,
  );

  const rails: Array<{
    code: string;
    title: string;
    categorySlug: string;
    items: CatalogProduct[];
  }> = [];
  let currentSlug: string | null = null;
  let items: CatalogProduct[] = [];
  const flush = () => {
    if (!currentSlug) return;
    const category = categories.categories.find((entry) => entry.slug === currentSlug);
    if (category && items.length > 0) {
      rails.push({
        code: category.code,
        title: category.name,
        categorySlug: category.slug,
        items,
      });
    }
    items = [];
  };
  for (const row of rows) {
    if (currentSlug !== row.categorySlug) {
      flush();
      currentSlug = row.categorySlug;
    }
    const product = hydrated.get(row.productId);
    if (product) items.push(product);
  }
  flush();

  return { categories: categories.categories, rails };
}
