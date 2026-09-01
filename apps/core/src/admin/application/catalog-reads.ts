import type {
  AdminCatalogSkuSummary,
  AdminInventoryLedgerRequest,
  AdminCategoryListRequest,
  AdminCategoryPage,
  AdminCategoryDetail,
  AdminCategoryDetailRequest,
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
  AdminProductListSummary,
  AdminUnitListRequest,
  AdminUnitSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import { DEFAULT_FULFILLMENT_LOCATION_ID, DEFAULT_MARKET_CODE } from "@freshmarkets/config";
import { setD1SpanAttributes, traceOperation } from "../../observability";
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

/** Bounded keyset category list ordered by sort order and stable identity. */
export async function listAdminCategories(
  deps: CatalogAdministrationDeps,
  request: AdminCategoryListRequest,
): Promise<RpcResult<AdminCategoryPage>> {
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
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (query !== "") {
    clauses.push("(c.name LIKE ? OR c.code LIKE ?)");
    binds.push(`%${query}%`, `%${query}%`);
  }
  if (request.status !== undefined) {
    clauses.push("c.status=?");
    binds.push(request.status);
  }
  if (cursor) {
    clauses.push("(c.sort_order > ? OR (c.sort_order=? AND c.id>?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(
      `SELECT c.id AS categoryId, c.code, c.name, c.slug, c.status,
              c.sort_order AS sortOrder, c.icon_asset_key AS iconAssetKey,
              c.parent_id AS parentCategoryId, parent.name AS parentName, c.version,
              (SELECT COUNT(*) FROM product p WHERE p.category_id=c.id) AS productCount
       FROM category c LEFT JOIN category parent ON parent.id=c.parent_id
       ${where} ORDER BY c.sort_order, c.id LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<AdminCategorySummary>();
  const hasMore = rows.results.length > limit;
  const items = rows.results.slice(0, limit);
  const last = items[items.length - 1];
  return {
    ok: true,
    value: {
      items,
      nextCursor:
        hasMore && last
          ? encodeStaffCursor({ createdAt: last.sortOrder, id: last.categoryId })
          : null,
    },
    requestId: request.requestId,
  };
}

/** Decision-facing Category detail with hierarchy, contained products, permissions, and Audit. */
export async function getAdminCategory(
  deps: CatalogAdministrationDeps,
  request: AdminCategoryDetailRequest,
): Promise<RpcResult<AdminCategoryDetail>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.read");
  if (!access.ok) return access;
  const row = await deps.db
    .prepare(
      `SELECT c.id AS categoryId, c.code, c.name, c.slug, c.status,
              c.sort_order AS sortOrder, c.icon_asset_key AS iconAssetKey, c.version,
              parent.id AS parentId, parent.code AS parentCode, parent.name AS parentName
       FROM category c LEFT JOIN category parent ON parent.id=c.parent_id WHERE c.id=?`,
    )
    .bind(request.categoryId)
    .first<{
      categoryId: string;
      code: string;
      name: string;
      slug: string;
      status: "active" | "inactive";
      sortOrder: number;
      iconAssetKey: string | null;
      version: number;
      parentId: string | null;
      parentCode: string | null;
      parentName: string | null;
    }>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Category not found", requestId: request.requestId },
    };
  }
  const [children, products, audits, manage] = await Promise.all([
    deps.db
      .prepare(
        `SELECT c.id AS categoryId, c.code, c.name, c.slug, c.status,
                c.sort_order AS sortOrder, c.icon_asset_key AS iconAssetKey,
                c.parent_id AS parentCategoryId, parent.name AS parentName, c.version,
                (SELECT COUNT(*) FROM product p WHERE p.category_id=c.id) AS productCount
         FROM category c LEFT JOIN category parent ON parent.id=c.parent_id
         WHERE c.parent_id=? ORDER BY c.sort_order, c.code`,
      )
      .bind(request.categoryId)
      .all<AdminCategoryDetail["children"][number]>(),
    deps.db
      .prepare(
        `SELECT p.id AS productId, p.slug, p.name, p.status, p.version,
                (SELECT COUNT(*) FROM sku s WHERE s.product_id=p.id) AS skuCount
         FROM product p WHERE p.category_id=? ORDER BY p.name, p.id LIMIT 100`,
      )
      .bind(request.categoryId)
      .all<AdminCategoryDetail["products"][number]>(),
    deps.db
      .prepare(
        `SELECT id AS auditEventId, occurred_at AS occurredAt, actor_user_id AS actorId,
                action, aggregate_type AS resourceType, aggregate_id AS resourceId,
                market_id AS marketId, location_id AS locationId, reason, correlation_id AS correlationId
         FROM audit_event WHERE aggregate_type='category' AND aggregate_id=?
         ORDER BY occurred_at DESC, id DESC LIMIT 10`,
      )
      .bind(request.categoryId)
      .all<
        Omit<AdminCategoryDetail["recentAudit"][number], "occurredAt"> & { occurredAt: number }
      >(),
    resolveCatalogAdministrationAccess(deps, request, "catalog.manage"),
  ]);
  return {
    ok: true,
    value: {
      categoryId: row.categoryId,
      code: row.code,
      name: row.name,
      slug: row.slug,
      status: row.status,
      sortOrder: row.sortOrder,
      iconAssetKey: row.iconAssetKey,
      version: row.version,
      parent:
        row.parentId && row.parentCode && row.parentName
          ? { categoryId: row.parentId, code: row.parentCode, name: row.parentName }
          : null,
      children: children.results,
      products: products.results,
      allowedActions: manage.ok ? ["UPDATE", "SET_STATUS"] : [],
      recentAudit: audits.results.map((audit) => ({
        ...audit,
        occurredAt: new Date(audit.occurredAt).toISOString(),
      })),
    },
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
      `SELECT id AS unitId, code, name AS displayName, dimension,
              canonical_base_code AS canonicalBaseCode,
              conversion_numerator AS conversionNumerator,
              conversion_denominator AS conversionDenominator,
              status, version
       FROM unit ORDER BY dimension, code`,
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

  const target = await deps.db
    .prepare(
      `SELECT m.id AS marketId, m.currency, fl.id AS locationId
       FROM market m LEFT JOIN fulfillment_location fl
         ON fl.market_id=m.id AND fl.id=?
       WHERE m.id=?`,
    )
    .bind(request.locationId, request.marketId)
    .first<{ marketId: string; currency: string; locationId: string | null }>();
  if (!target || (request.locationId !== null && target.locationId !== request.locationId)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "The selected market/location pricing context does not exist",
        requestId: request.requestId,
      },
    };
  }

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
  if (request.status !== undefined) {
    clauses.push("p.status = ?");
    binds.push(request.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const now = Date.now();
  const rows = await traceOperation(
    "db.admin.products.list",
    { requestId: request.requestId, readModel: "admin.products.list" },
    async (span) => {
      const result = await deps.db
        .prepare(
          `SELECT p.id AS productId, p.slug, p.name, c.code AS categoryCode, p.status, p.version,
              p.created_at AS createdAt,
              (SELECT COUNT(*) FROM sku s WHERE s.product_id = p.id) AS skuCount,
              (SELECT COUNT(*) FROM sku s WHERE s.product_id = p.id AND s.status='active') AS activeSkuCount,
              (SELECT COUNT(*) FROM sku s WHERE s.product_id = p.id AND s.status='active'
                AND EXISTS (
                  SELECT 1 FROM price_version pv WHERE pv.sku_id=s.id AND pv.market_id=?
                    AND ((? IS NULL AND pv.location_id IS NULL)
                      OR (? IS NOT NULL AND (pv.location_id=? OR pv.location_id IS NULL)))
                    AND pv.price_type='STANDARD' AND pv.valid_from<=?
                    AND (pv.valid_to IS NULL OR pv.valid_to>?)
                )) AS pricedSkuCount,
              (SELECT COUNT(*) FROM sku s JOIN sku_location_availability sla
                 ON sla.sku_id=s.id AND sla.location_id=? AND sla.availability_status='AVAILABLE'
               WHERE s.product_id=p.id AND s.status='active') AS availableSkuCount,
              (SELECT pm.id FROM product_media pm
               WHERE pm.product_id=p.id AND pm.status='active' AND pm.is_primary=1 LIMIT 1) AS mediaId,
              (SELECT pm.alt_text FROM product_media pm
               WHERE pm.product_id=p.id AND pm.status='active' AND pm.is_primary=1 LIMIT 1) AS mediaAltText,
              (SELECT pm.version FROM product_media pm
               WHERE pm.product_id=p.id AND pm.status='active' AND pm.is_primary=1 LIMIT 1) AS mediaVersion,
              (SELECT MIN((SELECT pv.amount_minor FROM price_version pv
                WHERE pv.sku_id=s.id AND pv.market_id=?
                  AND ((? IS NULL AND pv.location_id IS NULL)
                    OR (? IS NOT NULL AND (pv.location_id=? OR pv.location_id IS NULL)))
                  AND pv.price_type='STANDARD' AND pv.valid_from<=?
                  AND (pv.valid_to IS NULL OR pv.valid_to>?)
                ORDER BY CASE WHEN pv.location_id=? THEN 0 ELSE 1 END,
                         pv.valid_from DESC, pv.version DESC, pv.id DESC LIMIT 1))
               FROM sku s WHERE s.product_id=p.id AND s.status='active') AS minimumMinor,
              (SELECT MAX((SELECT pv.amount_minor FROM price_version pv
                WHERE pv.sku_id=s.id AND pv.market_id=?
                  AND ((? IS NULL AND pv.location_id IS NULL)
                    OR (? IS NOT NULL AND (pv.location_id=? OR pv.location_id IS NULL)))
                  AND pv.price_type='STANDARD' AND pv.valid_from<=?
                  AND (pv.valid_to IS NULL OR pv.valid_to>?)
                ORDER BY CASE WHEN pv.location_id=? THEN 0 ELSE 1 END,
                         pv.valid_from DESC, pv.version DESC, pv.id DESC LIMIT 1))
               FROM sku s WHERE s.product_id=p.id AND s.status='active') AS maximumMinor
       FROM product p JOIN category c ON c.id = p.category_id
       ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ?`,
        )
        .bind(
          request.marketId,
          request.locationId,
          request.locationId,
          request.locationId,
          now,
          now,
          request.locationId ?? "",
          request.marketId,
          request.locationId,
          request.locationId,
          request.locationId,
          now,
          now,
          request.locationId,
          request.marketId,
          request.locationId,
          request.locationId,
          request.locationId,
          now,
          now,
          request.locationId,
          ...binds,
          limit + 1,
        )
        .all<{
          productId: string;
          slug: string;
          name: string;
          categoryCode: string;
          status: "active" | "inactive";
          createdAt: number;
          skuCount: number;
          activeSkuCount: number;
          pricedSkuCount: number;
          availableSkuCount: number;
          mediaId: string | null;
          mediaAltText: string | null;
          mediaVersion: number | null;
          minimumMinor: number | null;
          maximumMinor: number | null;
          version: number;
        }>();
      setD1SpanAttributes(span, result.meta);
      span.setAttribute("db.rows.returned", result.results.length);
      return result;
    },
  );
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items: AdminProductListSummary[] = pageRows.map((row) => ({
    productId: row.productId,
    slug: row.slug,
    name: row.name,
    categoryCode: row.categoryCode,
    status: row.status,
    skuCount: row.skuCount,
    activeSkuCount: row.activeSkuCount,
    pricedSkuCount: row.pricedSkuCount,
    availableSkuCount: row.availableSkuCount,
    primaryMedia:
      row.mediaId && row.mediaAltText !== null && row.mediaVersion !== null
        ? { mediaId: row.mediaId, altText: row.mediaAltText, version: row.mediaVersion }
        : null,
    priceRange:
      row.minimumMinor !== null && row.maximumMinor !== null
        ? {
            minimumMinor: row.minimumMinor,
            maximumMinor: row.maximumMinor,
            currency: target.currency,
          }
        : null,
    version: row.version,
  }));
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.createdAt, id: last.productId }) : null;
  const [productStatuses, missingPrimaryMedia, missingPrices, unavailableSkus] = await Promise.all([
    deps.db
      .prepare(
        `SELECT SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS activeProducts,
                SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END) AS inactiveProducts
         FROM product`,
      )
      .first<{ activeProducts: number | null; inactiveProducts: number | null }>(),
    deps.db
      .prepare(
        `SELECT COUNT(*) AS count FROM product p
         WHERE NOT EXISTS (SELECT 1 FROM product_media pm
           WHERE pm.product_id=p.id AND pm.status='active' AND pm.is_primary=1)`,
      )
      .first<{ count: number }>(),
    deps.db
      .prepare(
        `SELECT COUNT(*) AS count FROM sku s JOIN product p ON p.id=s.product_id
         WHERE p.status='active' AND s.status='active' AND NOT EXISTS (
           SELECT 1 FROM price_version pv WHERE pv.sku_id=s.id AND pv.market_id=?
             AND ((? IS NULL AND pv.location_id IS NULL)
               OR (? IS NOT NULL AND (pv.location_id=? OR pv.location_id IS NULL)))
             AND pv.price_type='STANDARD' AND pv.valid_from<=?
             AND (pv.valid_to IS NULL OR pv.valid_to>?))`,
      )
      .bind(request.marketId, request.locationId, request.locationId, request.locationId, now, now)
      .first<{ count: number }>(),
    request.locationId === null
      ? Promise.resolve({ count: 0 })
      : deps.db
          .prepare(
            `SELECT COUNT(*) AS count FROM sku s JOIN product p ON p.id=s.product_id
             LEFT JOIN sku_location_availability sla
               ON sla.sku_id=s.id AND sla.location_id=?
             WHERE p.status='active' AND s.status='active'
               AND (sla.availability_status IS NULL OR sla.availability_status<>'AVAILABLE')`,
          )
          .bind(request.locationId)
          .first<{ count: number }>(),
  ]);
  return {
    ok: true,
    value: {
      items,
      nextCursor,
      pricingContext: {
        marketId: target.marketId,
        locationId: request.locationId,
        currency: target.currency,
      },
      readiness: {
        activeProducts: productStatuses?.activeProducts ?? 0,
        inactiveProducts: productStatuses?.inactiveProducts ?? 0,
        missingPrimaryMedia: missingPrimaryMedia?.count ?? 0,
        missingPrices: missingPrices?.count ?? 0,
        unavailableSkus: unavailableSkus?.count ?? 0,
      },
    },
    requestId: request.requestId,
  };
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
  availabilityVersion: number | null;
  sourcingMode: "STOCKED" | "PLANNED" | "ON_DEMAND" | "MIXED" | null;
};

/** One product's admin detail: identity, category, SKUs with price/availability. */
export async function getAdminProduct(
  deps: CatalogAdministrationDeps,
  request: AdminProductDetailRequest,
): Promise<RpcResult<AdminProductDetail>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.read");
  if (!access.ok) return access;

  const defaultMarket = await defaultMarketId(deps.db);
  const marketId = request.marketId ?? defaultMarket;
  if (!marketId || (request.locationId && !request.marketId)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "A valid market is required for the selected Catalog target",
        requestId: request.requestId,
      },
    };
  }
  const locationId =
    request.locationId ?? (request.marketId ? null : DEFAULT_FULFILLMENT_LOCATION_ID);
  const target = await deps.db
    .prepare(
      `SELECT m.id AS marketId, m.currency, fl.id AS locationId
       FROM market m LEFT JOIN fulfillment_location fl
         ON fl.market_id=m.id AND fl.id=?
       WHERE m.id=?`,
    )
    .bind(locationId, marketId)
    .first<{ marketId: string; currency: string; locationId: string | null }>();
  if (!target || (locationId && target.locationId !== locationId)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "The selected market/location target does not exist",
        requestId: request.requestId,
      },
    };
  }
  const product = await deps.db
    .prepare(
      `SELECT p.id AS productId, p.category_id AS categoryId, p.slug, p.name, p.description,
              c.code AS categoryCode, c.name AS categoryName, p.status, p.version,
              ip.id AS inventoryPoolId, u.id AS baseUnitId,
              u.canonical_base_code AS baseUnitCode, u.symbol AS baseUnitSymbol
       FROM product p JOIN category c ON c.id = p.category_id
       JOIN inventory_pool ip ON ip.id=p.inventory_pool_id
       JOIN unit u ON u.id=ip.base_unit_id
       WHERE p.id = ?`,
    )
    .bind(request.productId)
    .first<{
      productId: string;
      categoryId: string;
      slug: string;
      name: string;
      description: string | null;
      categoryCode: string;
      categoryName: string;
      status: "active" | "inactive";
      version: number;
      inventoryPoolId: string;
      baseUnitId: string;
      baseUnitCode: "GRAM" | "MILLILITER" | "PIECE";
      baseUnitSymbol: string;
    }>();
  if (!product) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Product not found", requestId: request.requestId },
    };
  }

  const now = Date.now();
  const skus = await deps.db
    .prepare(
      `SELECT s.id AS skuId, s.code, s.name, s.merchandising_label AS merchandisingLabel,
              u.symbol AS unitSymbol, s.sell_quantity AS sellQuantity,
              s.consumption_base_quantity AS consumptionBaseQuantity,
              s.status, s.sort_order AS sortOrder, s.version,
              current_price.amount_minor AS priceMinor,
              current_price.currency,
              current_price.version AS priceVersion,
              sla.availability_status AS availability,
              sla.version AS availabilityVersion,
              sla.sourcing_mode AS sourcingMode
       FROM sku s JOIN unit u ON u.id = s.sellable_unit_id
       LEFT JOIN price_version current_price ON current_price.id = (
         SELECT pv.id FROM price_version pv
         WHERE pv.sku_id = s.id AND pv.market_id = ?
           AND ((? IS NULL AND pv.location_id IS NULL)
             OR (? IS NOT NULL AND (pv.location_id=? OR pv.location_id IS NULL)))
           AND pv.price_type = 'STANDARD' AND pv.valid_from <= ?
           AND (pv.valid_to IS NULL OR pv.valid_to > ?)
         ORDER BY CASE WHEN pv.location_id=? THEN 0 ELSE 1 END,
                  pv.valid_from DESC, pv.version DESC, pv.id DESC LIMIT 1
       )
       LEFT JOIN sku_location_availability sla
         ON sla.sku_id = s.id AND sla.location_id = ?
       WHERE s.product_id = ?
       ORDER BY s.sort_order, s.code`,
    )
    .bind(
      marketId,
      locationId,
      locationId,
      locationId,
      now,
      now,
      locationId,
      locationId ?? "",
      request.productId,
    )
    .all<SkuRow>();

  const [details, media, audits, manage] = await Promise.all([
    deps.db
      .prepare(
        "SELECT id AS detailId, label, value, sort_order AS sortOrder FROM product_detail WHERE product_id=? ORDER BY sort_order, id",
      )
      .bind(request.productId)
      .all<AdminProductDetail["customerDetails"][number]>(),
    deps.db
      .prepare(
        `SELECT id AS mediaId, mime_type AS mimeType, alt_text AS altText,
                is_primary AS isPrimary, sort_order AS sortOrder, status, version
         FROM product_media WHERE product_id=? AND status='active' ORDER BY is_primary DESC, sort_order, id`,
      )
      .bind(request.productId)
      .all<Omit<AdminProductDetail["media"][number], "isPrimary"> & { isPrimary: number }>(),
    deps.db
      .prepare(
        `SELECT id AS auditEventId, occurred_at AS occurredAt, actor_user_id AS actorId,
                action, aggregate_type AS resourceType, aggregate_id AS resourceId,
                market_id AS marketId, location_id AS locationId, reason, correlation_id AS correlationId
         FROM audit_event WHERE aggregate_type='product' AND aggregate_id=?
         ORDER BY occurred_at DESC, id DESC LIMIT 10`,
      )
      .bind(request.productId)
      .all<
        Omit<AdminProductDetail["recentAudit"][number], "occurredAt"> & { occurredAt: number }
      >(),
    resolveCatalogAdministrationAccess(deps, request, "catalog.manage"),
  ]);

  return {
    ok: true,
    value: {
      productId: product.productId,
      categoryId: product.categoryId,
      slug: product.slug,
      name: product.name,
      description: product.description,
      categoryCode: product.categoryCode,
      categoryName: product.categoryName,
      status: product.status,
      version: product.version,
      customerDetails: details.results,
      media: media.results.map((item) => ({ ...item, isPrimary: item.isPrimary === 1 })),
      inventoryPool: {
        inventoryPoolId: product.inventoryPoolId,
        baseUnitId: product.baseUnitId,
        baseUnitCode: product.baseUnitCode,
        baseUnitSymbol: product.baseUnitSymbol,
      },
      pricingContext: {
        marketId: target.marketId,
        locationId,
        currency: target.currency,
      },
      allowedActions: manage.ok ? ["UPDATE", "SET_STATUS"] : [],
      recentAudit: audits.results.map((audit) => ({
        ...audit,
        occurredAt: new Date(audit.occurredAt).toISOString(),
      })),
      skus: skus.results,
    },
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
              ib.on_hand AS onHandBase, ib.reserved AS reservedBase, ib.version
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
    version: row.version,
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
  const now = Date.now();
  const row = await deps.db
    .prepare(
      `SELECT s.id AS skuId, s.code, s.name, s.merchandising_label AS merchandisingLabel,
              u.symbol AS unitSymbol, s.sell_quantity AS sellQuantity,
              s.consumption_base_quantity AS consumptionBaseQuantity,
              s.status, s.sort_order AS sortOrder, s.version,
              current_price.amount_minor AS priceMinor,
              current_price.currency,
              current_price.version AS priceVersion,
              sla.availability_status AS availability,
              sla.version AS availabilityVersion,
              sla.sourcing_mode AS sourcingMode
       FROM sku s JOIN unit u ON u.id = s.sellable_unit_id
       LEFT JOIN price_version current_price ON current_price.id = (
         SELECT pv.id FROM price_version pv
         WHERE pv.sku_id = s.id AND pv.market_id = ? AND pv.location_id IS NULL
           AND pv.price_type = 'STANDARD' AND pv.valid_from <= ?
           AND (pv.valid_to IS NULL OR pv.valid_to > ?)
         ORDER BY pv.valid_from DESC, pv.version DESC, pv.id DESC LIMIT 1
       )
       LEFT JOIN sku_location_availability sla
         ON sla.sku_id = s.id AND sla.location_id = ?
       WHERE s.id = ?`,
    )
    .bind(marketId ?? "", now, now, DEFAULT_FULFILLMENT_LOCATION_ID, skuId)
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
    availabilityVersion: row.availabilityVersion,
    sourcingMode: row.sourcingMode,
  };
  return { ok: true, value: summary, requestId };
}
