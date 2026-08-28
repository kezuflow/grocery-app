import type {
  AdminCatalogSkuSummary,
  AdminInventoryLedgerRequest,
  AdminCategoryListRequest,
  AdminCategoryPage,
  AdminCategorySummary,
  AdminInventoryItem,
  AdminInventoryLedgerEntry,
  AdminInventoryLedgerPage,
  AdminInventoryListRequest,
  AdminInventoryPage,
  AdminProductDetail,
  AdminProductDetailRequest,
  AdminProductListRequest,
  AdminProductPage,
  AdminProductSummary,
  AdminUnitListRequest,
  AdminUnitSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import { DEFAULT_FULFILLMENT_LOCATION_ID, DEFAULT_MARKET_CODE } from "@freshmarkets/config";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
} from "./catalog-administration-access";

const DEFAULT_MARKET_SELECT = "SELECT id FROM market WHERE code = ?";

export async function defaultMarketId(database: D1Database): Promise<string | null> {
  const row = await database
    .prepare(DEFAULT_MARKET_SELECT)
    .bind(DEFAULT_MARKET_CODE)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Bounded category list ordered by sort order. */
export async function listAdminCategories(
  deps: CatalogAdministrationDeps,
  request: AdminCategoryListRequest,
): Promise<RpcResult<AdminCategoryPage>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.read");
  if (!access.ok) return access;
  const rows = await deps.db
    .prepare(
      "SELECT id AS categoryId, code, name, slug, status, sort_order AS sortOrder FROM category ORDER BY sort_order, code LIMIT 100",
    )
    .all<AdminCategorySummary>();
  return {
    ok: true,
    value: { items: rows.results, nextCursor: null },
    requestId: request.requestId,
  };
}

/** The controlled unit registry. */
export async function listAdminUnits(
  deps: CatalogAdministrationDeps,
  request: AdminUnitListRequest,
): Promise<RpcResult<AdminUnitSummary[]>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.read");
  if (!access.ok) return access;
  const rows = await deps.db
    .prepare(
      "SELECT id AS unitId, code, name, dimension, symbol FROM unit ORDER BY dimension, code",
    )
    .all<AdminUnitSummary>();
  return { ok: true, value: rows.results, requestId: request.requestId };
}

/** Bounded keyset product listing with SKU counts and optional name search. */
export async function listAdminProducts(
  deps: CatalogAdministrationDeps,
  request: AdminProductListRequest,
): Promise<RpcResult<AdminProductPage>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.read");
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }
  const query = request.query?.trim() ?? "";
  if (query.length > 100) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "query is too long",
        requestId: request.requestId,
      },
    };
  }

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (cursor) {
    clauses.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  if (query !== "") {
    clauses.push("(p.name LIKE ? OR p.slug LIKE ?)");
    binds.push(`%${query}%`, `%${query}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(
      `SELECT p.id AS productId, p.slug, p.name, c.code AS categoryCode, p.status,
              p.created_at AS createdAt,
              (SELECT COUNT(*) FROM sku s WHERE s.product_id = p.id) AS skuCount
       FROM product p JOIN category c ON c.id = p.category_id
       ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<{
      productId: string;
      slug: string;
      name: string;
      categoryCode: string;
      status: "active" | "inactive";
      createdAt: number;
      skuCount: number;
    }>();
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items: AdminProductSummary[] = pageRows.map((row) => ({
    productId: row.productId,
    slug: row.slug,
    name: row.name,
    categoryCode: row.categoryCode,
    status: row.status,
    skuCount: row.skuCount,
  }));
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.createdAt, id: last.productId }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

type SkuRow = {
  skuId: string;
  code: string;
  name: string;
  merchandisingLabel: string | null;
  unitSymbol: string;
  sellQuantity: number;
  consumptionBaseQuantity: number;
  status: "active" | "inactive";
  sortOrder: number;
  version: number;
  priceMinor: number | null;
  currency: string | null;
  priceVersion: number | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | null;
};

/** One product's admin detail: identity, category, SKUs with price/availability. */
export async function getAdminProduct(
  deps: CatalogAdministrationDeps,
  request: AdminProductDetailRequest,
): Promise<RpcResult<AdminProductDetail>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.read");
  if (!access.ok) return access;

  const marketId = await defaultMarketId(deps.db);
  const product = await deps.db
    .prepare(
      `SELECT p.id AS productId, p.slug, p.name, p.description, c.code AS categoryCode,
              c.name AS categoryName, p.status
       FROM product p JOIN category c ON c.id = p.category_id
       WHERE p.id = ?`,
    )
    .bind(request.productId)
    .first<{
      productId: string;
      slug: string;
      name: string;
      description: string | null;
      categoryCode: string;
      categoryName: string;
      status: "active" | "inactive";
    }>();
  if (!product) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Product not found", requestId: request.requestId },
    };
  }

  const skus = await deps.db
    .prepare(
      `SELECT s.id AS skuId, s.code, s.name, s.merchandising_label AS merchandisingLabel,
              u.symbol AS unitSymbol, s.sell_quantity AS sellQuantity,
              s.consumption_base_quantity AS consumptionBaseQuantity,
              s.status, s.sort_order AS sortOrder, s.version,
              (SELECT pv.amount_minor FROM price_version pv
               WHERE pv.sku_id = s.id AND pv.market_id = ? AND pv.location_id IS NULL
                 AND pv.price_type = 'STANDARD' AND pv.valid_to IS NULL
               ORDER BY pv.version DESC LIMIT 1) AS priceMinor,
              (SELECT pv.currency FROM price_version pv
               WHERE pv.sku_id = s.id AND pv.market_id = ? AND pv.location_id IS NULL
                 AND pv.price_type = 'STANDARD' AND pv.valid_to IS NULL
               ORDER BY pv.version DESC LIMIT 1) AS currency,
              (SELECT pv.version FROM price_version pv
               WHERE pv.sku_id = s.id AND pv.market_id = ? AND pv.location_id IS NULL
                 AND pv.price_type = 'STANDARD' AND pv.valid_to IS NULL
               ORDER BY pv.version DESC LIMIT 1) AS priceVersion,
              (SELECT sla.availability_status FROM sku_location_availability sla
               WHERE sla.sku_id = s.id AND sla.location_id = ?) AS availability
       FROM sku s JOIN unit u ON u.id = s.sellable_unit_id
       WHERE s.product_id = ?
       ORDER BY s.sort_order, s.code`,
    )
    .bind(
      marketId ?? "",
      marketId ?? "",
      marketId ?? "",
      DEFAULT_FULFILLMENT_LOCATION_ID,
      request.productId,
    )
    .all<SkuRow>();

  return {
    ok: true,
    value: { ...product, skus: skus.results },
    requestId: request.requestId,
  };
}

/** Operational-location-scoped inventory balances for one location. */
export async function listAdminInventory(
  deps: CatalogAdministrationDeps,
  request: AdminInventoryListRequest,
): Promise<RpcResult<AdminInventoryPage>> {
  const access = await resolveCatalogAdministrationAccess(
    deps,
    request,
    "inventory.read",
    request.locationId,
  );
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clauses = ["ib.location_id = ?"];
  const binds: unknown[] = [request.locationId];
  if (cursor) {
    clauses.push("(ip.product_id > ?)");
    binds.push(cursor.id);
  }
  const rows = await deps.db
    .prepare(
      `SELECT ib.location_id AS locationId, ib.inventory_pool_id AS inventoryPoolId,
              p.id AS productId, p.name AS productName, u.symbol AS baseUnitSymbol,
              ib.on_hand AS onHandBase, ib.reserved AS reservedBase
       FROM inventory_balance ib
       JOIN inventory_pool ip ON ip.id = ib.inventory_pool_id
       JOIN product p ON p.inventory_pool_id = ip.id
       JOIN unit u ON u.id = ip.base_unit_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY ip.product_id LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<AdminInventoryItem & { locationId: string }>();
  const hasMore = rows.results.length > limit;
  const items = rows.results.slice(0, limit).map((row) => ({
    locationId: row.locationId,
    inventoryPoolId: row.inventoryPoolId,
    productId: row.productId,
    productName: row.productName,
    baseUnitSymbol: row.baseUnitSymbol,
    onHandBase: row.onHandBase,
    reservedBase: row.reservedBase,
  }));
  const nextCursor =
    hasMore && items.length > 0
      ? encodeStaffCursor({ createdAt: 0, id: items[items.length - 1]!.productId })
      : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** Bounded keyset ledger for one (location, pool) pair. */
export async function getAdminInventoryLedger(
  deps: CatalogAdministrationDeps,
  request: AdminInventoryLedgerRequest,
): Promise<RpcResult<AdminInventoryLedgerPage>> {
  const access = await resolveCatalogAdministrationAccess(
    deps,
    request,
    "inventory.read",
    request.locationId,
  );
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clauses = ["location_id = ?", "inventory_pool_id = ?"];
  const binds: unknown[] = [request.locationId, request.inventoryPoolId];
  if (cursor) {
    clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const rows = await deps.db
    .prepare(
      `SELECT id, movement_type AS movementType, quantity_delta_base AS quantityDeltaBase,
              reservation_delta_base AS reservationDeltaBase, reason_code AS reasonCode,
              actor_id AS actorId, created_at AS createdAt
       FROM inventory_ledger_entries
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<{
      id: string;
      movementType: string;
      quantityDeltaBase: number;
      reservationDeltaBase: number;
      reasonCode: string | null;
      actorId: string | null;
      createdAt: number;
    }>();
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items: AdminInventoryLedgerEntry[] = pageRows.map((row) => ({
    entryId: row.id,
    movementType: row.movementType,
    quantityDeltaBase: row.quantityDeltaBase,
    reservationDeltaBase: row.reservationDeltaBase,
    reasonCode: row.reasonCode,
    actorId: row.actorId,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** One SKU summary with current market price and default-location availability. */
export async function readSkuSummary(
  deps: CatalogAdministrationDeps,
  skuId: string,
  requestId: string,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const marketId = await defaultMarketId(deps.db);
  const row = await deps.db
    .prepare(
      `SELECT s.id AS skuId, s.code, s.name, s.merchandising_label AS merchandisingLabel,
              u.symbol AS unitSymbol, s.sell_quantity AS sellQuantity,
              s.consumption_base_quantity AS consumptionBaseQuantity,
              s.status, s.sort_order AS sortOrder, s.version,
              (SELECT pv.amount_minor FROM price_version pv
               WHERE pv.sku_id = s.id AND pv.market_id = ? AND pv.location_id IS NULL
                 AND pv.price_type = 'STANDARD' AND pv.valid_to IS NULL
               ORDER BY pv.version DESC LIMIT 1) AS priceMinor,
              (SELECT pv.currency FROM price_version pv
               WHERE pv.sku_id = s.id AND pv.market_id = ? AND pv.location_id IS NULL
                 AND pv.price_type = 'STANDARD' AND pv.valid_to IS NULL
               ORDER BY pv.version DESC LIMIT 1) AS currency,
              (SELECT pv.version FROM price_version pv
               WHERE pv.sku_id = s.id AND pv.market_id = ? AND pv.location_id IS NULL
                 AND pv.price_type = 'STANDARD' AND pv.valid_to IS NULL
               ORDER BY pv.version DESC LIMIT 1) AS priceVersion,
              (SELECT sla.availability_status FROM sku_location_availability sla
               WHERE sla.sku_id = s.id AND sla.location_id = ?) AS availability
       FROM sku s JOIN unit u ON u.id = s.sellable_unit_id
       WHERE s.id = ?`,
    )
    .bind(marketId ?? "", marketId ?? "", marketId ?? "", DEFAULT_FULFILLMENT_LOCATION_ID, skuId)
    .first<SkuRow>();
  if (!row) {
    return { ok: false, error: { code: "NOT_FOUND", message: "SKU not found", requestId } };
  }
  const summary: AdminCatalogSkuSummary = {
    skuId: row.skuId,
    code: row.code,
    name: row.name,
    merchandisingLabel: row.merchandisingLabel,
    unitSymbol: row.unitSymbol,
    sellQuantity: row.sellQuantity,
    consumptionBaseQuantity: row.consumptionBaseQuantity,
    status: row.status,
    sortOrder: row.sortOrder,
    version: row.version,
    priceMinor: row.priceMinor,
    currency: row.currency,
    priceVersion: row.priceVersion,
    availability: row.availability,
  };
  return { ok: true, value: summary, requestId };
}
