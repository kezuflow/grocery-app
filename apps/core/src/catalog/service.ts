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
import { productMediaProjectionSql, publishedProductMediaView } from "./published-product-media";
import { readPublicProductSalePrices } from "../promotions/application/product-sales";

/**
 * Minimal raw D1 surface used by catalog reads; catalog queries bypass ORM
 * row-mapping to keep pagination, windowed rails, and hydration as explicit
 * purpose-built SQL.
 */
type Database = Pick<D1Database, "prepare" | "batch">;

/** Seed identifiers remain fixtures, not pricing or routing fallbacks. */
export const MARKET_METRO_CEBU = "market-metro-cebu";

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
function eligibleSkuSubquery(): string {
  return `
    EXISTS (
      SELECT 1
      FROM sku candidate_sku
      JOIN sku_location_availability sla
        ON sla.sku_id = candidate_sku.id
       AND sla.location_id = ?
       AND sla.availability_status = 'AVAILABLE'
      JOIN price_version pv
        ON pv.sku_id = candidate_sku.id
       AND pv.market_id = ?
       AND pv.location_id = ?
       AND pv.price_type = 'STANDARD'
       AND pv.amount_minor > 0
       AND pv.valid_from <= ?
       AND (pv.valid_to IS NULL OR pv.valid_to > ?)
      WHERE candidate_sku.product_id = p.id
        AND candidate_sku.status = 'active'
    )`;
}

const PRODUCT_SELECT_COLUMNS = `
  p.id AS productId,
  p.slug AS slug,
  p.name AS productName,
  p.description AS description,
  ${productMediaProjectionSql} AS publishedMediaJson,
  c.code AS categoryCode,
  c.name AS categoryName,
  c.slug AS categorySlug,
  c.sort_order AS categorySortOrder`;

type ProductListRow = {
  productId: string;
  slug: string;
  productName: string;
  description: string | null;
  publishedMediaJson: string | null;
  categoryCode: string;
  categoryName: string;
  categorySlug: string;
  categorySortOrder: number;
};

function prepareProductRows(
  database: Database,
  options: {
    nowMs: number;
    requireSellable?: boolean;
    commerceContext?: { locationId: string; marketId: string };
    categorySlug?: string;
    query?: string;
    cursor?: string;
    limit?: number;
    slug?: string;
  },
): D1PreparedStatement {
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
  if (options.requireSellable && options.commerceContext) {
    conditions.push(eligibleSkuSubquery());
    parameters.push(
      options.commerceContext.locationId,
      options.commerceContext.marketId,
      options.commerceContext.locationId,
      options.nowMs,
      options.nowMs,
    );
  }

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

  void hasCursor;
  return database.prepare(statement).bind(...parameters);
}

async function selectProductRows(
  database: Database,
  options: Parameters<typeof prepareProductRows>[1],
) {
  return (await prepareProductRows(database, options).all<ProductListRow>()).results;
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
  stock_pool_id: string | null;
  estimated_shipping_weight_grams: number | null;
};

type PriceRow = { sku_id: string; amount_minor: number; currency: string; version: number };

type CommerceContext = { locationId: string; marketId: string };

async function resolveCommerceContext(
  database: Database,
  locationId: string | undefined,
): Promise<CommerceContext | null> {
  if (!locationId) return null;
  const row = await database
    .prepare(
      "SELECT id locationId,market_id marketId FROM fulfillment_location WHERE id=? AND status='active' AND purpose='CUSTOMER_FULFILLMENT'",
    )
    .bind(locationId)
    .first<CommerceContext>();
  if (!row) throw new CatalogValidationError("Unknown active delivery location");
  return row;
}

function prepareHydration(
  database: Database,
  ids: string[],
  idList: string,
  context: CommerceContext | null,
  nowMs: number,
): Array<D1PreparedStatement | null> {
  const skuIdList = `(SELECT id FROM sku WHERE product_id IN (${idList}))`;

  return [
    database
      .prepare(`SELECT s.id, s.product_id, s.code, s.name, u.symbol AS symbol, u.code AS unit_code,
                s.merchandising_label, s.sell_quantity, s.consumption_base_quantity,s.stock_pool_id,s.estimated_shipping_weight_grams
         FROM sku s JOIN unit u ON u.id = s.sellable_unit_id
         WHERE s.status = 'active' AND s.product_id IN (${idList})
         ORDER BY s.product_id ASC, s.sort_order ASC, s.id ASC`)
      .bind(...ids),
    context
      ? database
          .prepare(`WITH ranked_prices AS (
           SELECT pv.sku_id, pv.amount_minor, pv.currency, pv.version,
                  ROW_NUMBER() OVER (
                    PARTITION BY pv.sku_id
                    ORDER BY pv.valid_from DESC, pv.version DESC, pv.id DESC
                  ) AS winner_rank
           FROM price_version pv
           WHERE pv.sku_id IN ${skuIdList}
             AND pv.market_id = ? AND pv.price_type = 'STANDARD'
             AND pv.location_id = ?
             AND pv.amount_minor > 0
             AND pv.valid_from <= ${nowMs}
             AND (pv.valid_to IS NULL OR pv.valid_to > ${nowMs})
         )
         SELECT sku_id, amount_minor, currency, version
         FROM ranked_prices WHERE winner_rank = 1`)
          .bind(...ids, context.marketId, context.locationId)
      : null,
    context
      ? database
          .prepare(`SELECT DISTINCT sku_id FROM sku_location_availability
         WHERE location_id = ? AND availability_status = 'AVAILABLE'
           AND sku_id IN ${skuIdList}`)
          .bind(context.locationId, ...ids)
      : null,
    context
      ? database
          .prepare(`SELECT s.id sku_id,COALESCE(b.on_hand-b.reserved,0)-COALESCE((SELECT SUM(h.quantity) FROM checkout_inventory_holds h WHERE h.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id) AND h.location_id=? AND h.status='HELD'),0) available_base
         FROM product p JOIN sku s ON s.product_id=p.id LEFT JOIN inventory_balance b
           ON b.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id) AND b.location_id=?
         WHERE p.id IN (${idList})`)
          .bind(context.locationId, context.locationId, ...ids)
      : null,
    context
      ? database
          .prepare(
            `SELECT configuration.fulfillment_mode activeMode,
                    CASE WHEN configuration.fulfillment_mode='INSTANT' THEN 1 ELSE EXISTS (
                      SELECT 1 FROM delivery_cycle cycle
                      JOIN delivery_cycle_zone cycle_zone ON cycle_zone.cycle_id=cycle.id
                        AND cycle_zone.location_id=? AND cycle_zone.status='ACTIVE'
                      WHERE cycle.market_id=? AND cycle.status='OPEN' AND cycle.cutoff_at>?
                    ) END modeAvailable
             FROM global_commerce_configuration configuration WHERE configuration.id='global'`,
          )
          .bind(context.locationId, context.marketId, nowMs)
      : null,
    database
      .prepare(`SELECT product_id, label, value, sort_order AS sortOrder
         FROM product_detail WHERE product_id IN (${idList})
         ORDER BY sort_order ASC, label ASC`)
      .bind(...ids),
    database
      .prepare(`SELECT sku_id, label, value FROM sku_detail
         WHERE audience = 'CUSTOMER' AND sku_id IN ${skuIdList}
         ORDER BY sort_order ASC, label ASC`)
      .bind(...ids),
  ];
}

/** Expand a bounded page using one D1 batch, followed by applicable sale pricing. */
async function hydrateProducts(
  database: Database,
  rows: ReadonlyArray<ProductListRow>,
  context: CommerceContext | null,
  nowMs: number,
) {
  if (!rows.length) return new Map<string, CatalogProduct>();
  const ids = rows.map((row) => row.productId);
  const statements = prepareHydration(database, ids, sqlPlaceholders(ids.length), context, nowMs);
  const batch = await database.batch(statements.filter((statement) => statement !== null));
  return assembleProducts(database, rows, context, nowMs, statements, batch);
}

async function assembleProducts(
  database: Database,
  rows: ReadonlyArray<ProductListRow>,
  context: CommerceContext | null,
  nowMs: number,
  statements: Array<D1PreparedStatement | null>,
  batch: D1Result[],
): Promise<Map<string, CatalogProduct>> {
  const hydrated = new Map<string, CatalogProduct>();
  let resultIndex = 0;
  const [
    skuRows,
    priceRows,
    availabilityRows,
    inventoryRows,
    modeRows,
    productDetailRows,
    skuDetailRows,
  ] = statements.map((statement) => (statement ? batch[resultIndex++].results : [])) as [
    SkuRow[],
    PriceRow[],
    { sku_id: string }[],
    { sku_id: string; available_base: number }[],
    { activeMode: "INSTANT" | "SCHEDULED"; modeAvailable: number }[],
    { product_id: string; label: string; value: string; sortOrder: number }[],
    { sku_id: string; label: string; value: string }[],
  ];
  const modeRow = modeRows[0] ?? null;

  const skusByProduct = new Map<string, SkuRow[]>();
  for (const sku of skuRows) {
    const bucket = skusByProduct.get(sku.product_id) ?? [];
    bucket.push(sku);
    skusByProduct.set(sku.product_id, bucket);
  }
  const availableSkuIds = new Set(availabilityRows.map((row) => row.sku_id));
  const inventoryBySku = new Map(inventoryRows.map((row) => [row.sku_id, row.available_base]));
  const activeMode = modeRow?.activeMode ?? "SCHEDULED";
  const modeAvailable = modeRow?.modeAvailable === 1;
  const salePrices =
    context && modeAvailable
      ? await readPublicProductSalePrices(database, {
          locationId: context.locationId,
          fulfillmentMode: activeMode,
          at: nowMs,
          prices: priceRows.map((price) => ({
            skuId: price.sku_id,
            priceMinor: price.amount_minor,
          })),
        })
      : new Map<string, NonNullable<CatalogVariant["sale"]>>();
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
    const media = publishedProductMediaView(row.publishedMediaJson);
    const variants: CatalogVariant[] = (skusByProduct.get(row.productId) ?? [])
      .filter((sku) => !context || availableSkuIds.has(sku.id))
      .map((sku) => {
        const price = pricesBySku.get(sku.id) ?? null;
        const availability: CatalogVariant["availability"] = !context
          ? "LOCATION_REQUIRED"
          : !price
            ? "PRICE_UNAVAILABLE"
            : !modeAvailable
              ? "OUT_OF_STOCK"
              : activeMode === "INSTANT" &&
                  (inventoryBySku.get(sku.id) ?? 0) < sku.consumption_base_quantity
                ? "OUT_OF_STOCK"
                : "AVAILABLE";
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
            sku.stock_pool_id && sku.estimated_shipping_weight_grams
              ? (customerNotesBySku.get(sku.id) ??
                `Approx. ${sku.estimated_shipping_weight_grams.toLocaleString("en-PH")} g per ${sku.merchandising_label?.toLowerCase() || "piece"}`)
              : sku.merchandising_label !== null
                ? (customerNotesBySku.get(sku.id) ?? null)
                : null,
          priceMinor: price?.amount_minor ?? null,
          ...(availability === "AVAILABLE" && salePrices.has(sku.id)
            ? { sale: salePrices.get(sku.id) }
            : {}),
          currency: price?.currency ?? null,
          priceVersion: price?.version ?? null,
          availability,
        };
      });
    const anySellableVariant = variants.some((variant) => variant.availability === "AVAILABLE");
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
  const context = await resolveCommerceContext(database, input.locationId);
  if (input.cursor !== undefined) decodeCatalogCursor(input.cursor); // fail fast

  const requestedLimit = Math.min(Math.max(1, input.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
  const rows = await selectProductRows(database, {
    nowMs,
    requireSellable: Boolean(context),
    commerceContext: context ?? undefined,
    query: input.query,
    categorySlug: input.categorySlug,
    cursor: input.cursor,
    limit: requestedLimit,
  });

  const hasNextPage = rows.length > requestedLimit;
  const pageRows = hasNextPage ? rows.slice(0, -1) : rows;
  const hydrated = await hydrateProducts(database, pageRows, context, nowMs);
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
  const context = await resolveCommerceContext(database, locationId);
  const statements = prepareHydration(
    database,
    [slug],
    "SELECT id FROM product WHERE slug=? AND status='active'",
    context,
    nowMs,
  );
  // Resolve the product, variants, customer notes and gallery in one D1 call.
  // The subquery scopes every hydration statement without waiting for an ID lookup.
  const result = await database.batch([
    prepareProductRows(database, { nowMs, slug, limit: 1 }),
    ...statements.filter((statement) => statement !== null),
    database
      .prepare(`SELECT m.id mediaId,m.version,m.alt_text altText FROM product_media m
      JOIN product p ON p.id=m.product_id AND p.status='active'
      JOIN category c ON c.id=p.category_id AND c.status='active'
      WHERE p.slug=? AND m.status='active' ORDER BY m.is_primary DESC,m.sort_order,m.id LIMIT 5`)
      .bind(slug),
  ]);
  const rows = result[0].results as ProductListRow[];
  const row = rows[0];
  if (!row || row.slug !== slug) return null;
  const hydrated = await assembleProducts(
    database,
    [row],
    context,
    nowMs,
    statements,
    result.slice(1, -1),
  );
  const product = hydrated.get(row.productId);
  if (!product) return null;
  const media = result[result.length - 1].results as {
    mediaId: string;
    version: number;
    altText: string;
  }[];
  const images = media.flatMap((row) => {
    const image = publishedProductMediaView(JSON.stringify(row));
    return image ? [image] : [];
  });
  return { product, images, deliveryContext: { locationAware: Boolean(locationId) } };
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
  const context = await resolveCommerceContext(database, input.locationId);
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
         ${context ? `AND ${eligibleSkuSubquery()}` : ""}
     )
     WHERE rn <= ?
     ORDER BY categorySortOrder ASC, productName ASC, productId ASC`,
    context
      ? [context.locationId, context.marketId, context.locationId, nowMs, nowMs, itemsPerRail]
      : [itemsPerRail],
  );
  if (rows.length === 0) return { categories: categories.categories, rails: [] };

  const hydrated = await hydrateProducts(database, rows, context, nowMs);

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
