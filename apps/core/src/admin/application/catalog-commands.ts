import type {
  AdminCategoryCreateRequest,
  AdminCategorySummary,
  AdminCatalogSkuSummary,
  AdminProductStatusRequest,
  AdminProductSummary,
  AdminSkuAvailabilityRequest,
  AdminSkuCreateRequest,
  AdminSkuUpdateRequest,
  AdminSkuPriceRequest,
  AdminUnitCreateRequest,
  AdminUnitSummary,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import { readSkuSummary } from "./catalog-reads";
import {
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
} from "./catalog-administration-access";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function idempotencyComplete(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  now: number,
): D1PreparedStatement {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, now, scope, key);
}

function idempotencyFailed(database: D1Database, scope: string, key: string): Promise<unknown> {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

/** Create an active category over the closed status vocabulary. */
export async function createAdminCategory(
  deps: CatalogAdministrationDeps,
  request: AdminCategoryCreateRequest,
): Promise<RpcResult<AdminCategorySummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;

  const code = request.code.trim().toUpperCase();
  const name = request.name.trim();
  const slug = request.slug.trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code) || name === "" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return failure(
      "VALIDATION_FAILED",
      "code, name, and kebab-case slug are required",
      request.requestId,
    );
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.category",
    request.idempotencyKey,
    {
      code,
      name,
      slug,
      sortOrder: request.sortOrder ?? 0,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      const existing = await deps.db
        .prepare(
          "SELECT id AS categoryId, code, name, slug, status, sort_order AS sortOrder FROM category WHERE id = ?",
        )
        .bind(claim.existing.resultReference)
        .first<AdminCategorySummary>();
      if (existing) return { ok: true, value: existing, requestId: request.requestId };
    }
    return failure("CONFLICT", "The create command is still processing", request.requestId);
  }

  const categoryId = crypto.randomUUID();
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          "INSERT INTO category (id, code, name, slug, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
        )
        .bind(categoryId, code, name, slug, request.sortOrder ?? 0, now, now),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.CATEGORY_CREATED",
        resourceType: "category",
        resourceId: categoryId,
        details: { code, slug },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(
        deps.db,
        "admin.catalog.category",
        request.idempotencyKey,
        categoryId,
        now,
      ),
    ]);
  } catch (error) {
    log("error", "admin.catalog.category_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, "admin.catalog.category", request.idempotencyKey);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      return failure(
        "CONFLICT",
        "A category with this code or slug already exists",
        request.requestId,
      );
    }
    return failure("CONFLICT", "The category could not be created", request.requestId);
  }

  const created = await deps.db
    .prepare(
      "SELECT id AS categoryId, code, name, slug, status, sort_order AS sortOrder FROM category WHERE id = ?",
    )
    .bind(categoryId)
    .first<AdminCategorySummary>();
  if (!created) {
    return failure("INTERNAL_ERROR", "The category could not be read back", request.requestId);
  }
  return { ok: true, value: created, requestId: request.requestId };
}

/** Create a controlled unit. Same-dimension use is enforced at SKU creation. */
export async function createAdminUnit(
  deps: CatalogAdministrationDeps,
  request: AdminUnitCreateRequest,
): Promise<RpcResult<AdminUnitSummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;

  const code = request.code.trim();
  const name = request.name.trim();
  const symbol = request.symbol.trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code) || name === "" || symbol === "") {
    return failure("VALIDATION_FAILED", "code, name, and symbol are required", request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.unit",
    request.idempotencyKey,
    {
      code,
      name,
      dimension: request.dimension,
      symbol,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      const existing = await deps.db
        .prepare("SELECT id AS unitId, code, name, dimension, symbol FROM unit WHERE id = ?")
        .bind(claim.existing.resultReference)
        .first<AdminUnitSummary>();
      if (existing) return { ok: true, value: existing, requestId: request.requestId };
    }
    return failure("CONFLICT", "The create command is still processing", request.requestId);
  }

  const unitId = crypto.randomUUID();
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          "INSERT INTO unit (id, code, name, dimension, symbol, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(unitId, code, name, request.dimension, symbol, now),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.UNIT_CREATED",
        resourceType: "unit",
        resourceId: unitId,
        details: { code, dimension: request.dimension },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, "admin.catalog.unit", request.idempotencyKey, unitId, now),
    ]);
  } catch (error) {
    log("error", "admin.catalog.unit_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, "admin.catalog.unit", request.idempotencyKey);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      return failure("CONFLICT", "A unit with this code already exists", request.requestId);
    }
    return failure("CONFLICT", "The unit could not be created", request.requestId);
  }

  const created = await deps.db
    .prepare("SELECT id AS unitId, code, name, dimension, symbol FROM unit WHERE id = ?")
    .bind(unitId)
    .first<AdminUnitSummary>();
  if (!created) {
    return failure("INTERNAL_ERROR", "The unit could not be read back", request.requestId);
  }
  return { ok: true, value: created, requestId: request.requestId };
}

/** Activate or deactivate a product; guarded on current status, audited. */
export async function setAdminProductStatus(
  deps: CatalogAdministrationDeps,
  request: AdminProductStatusRequest,
): Promise<RpcResult<AdminProductSummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A reason is required", request.requestId);
  }

  const current = await deps.db
    .prepare("SELECT id, status FROM product WHERE id = ?")
    .bind(request.productId)
    .first<{ id: string; status: "active" | "inactive" }>();
  if (!current) return failure("NOT_FOUND", "Product not found", request.requestId);
  if (current.status === request.status) {
    return failure("VALIDATION_FAILED", `Product is already ${request.status}`, request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.product.status",
    request.idempotencyKey,
    {
      productId: request.productId,
      status: request.status,
      reason,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readProductSummary(deps, request.productId, request.requestId);
    }
    return failure("CONFLICT", "The status command is still processing", request.requestId);
  }

  const updated = await deps.db
    .prepare("UPDATE product SET status=?, updated_at=? WHERE id=? AND status=?")
    .bind(request.status, now, request.productId, current.status)
    .run();
  if ((updated.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, "admin.catalog.product.status", request.idempotencyKey);
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  }
  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "CATALOG.PRODUCT_STATUS_CHANGED",
      resourceType: "product",
      resourceId: request.productId,
      reason,
      before: { status: current.status },
      after: { status: request.status },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    idempotencyComplete(
      deps.db,
      "admin.catalog.product.status",
      request.idempotencyKey,
      request.productId,
      now,
    ),
  ]);
  return readProductSummary(deps, request.productId, request.requestId);
}

async function readProductSummary(
  deps: CatalogAdministrationDeps,
  productId: string,
  requestId: string,
): Promise<RpcResult<AdminProductSummary>> {
  const row = await deps.db
    .prepare(
      `SELECT p.id AS productId, p.slug, p.name, c.code AS categoryCode, p.status,
              (SELECT COUNT(*) FROM sku s WHERE s.product_id = p.id) AS skuCount
       FROM product p JOIN category c ON c.id = p.category_id WHERE p.id = ?`,
    )
    .bind(productId)
    .first<AdminProductSummary>();
  if (!row) return failure("NOT_FOUND", "Product not found", requestId);
  return { ok: true, value: row, requestId };
}

/** Create a SKU whose sellable unit matches the product pool's base dimension. */
export async function createAdminSku(
  deps: CatalogAdministrationDeps,
  request: AdminSkuCreateRequest,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;

  const code = request.code.trim().toUpperCase();
  const name = request.name.trim();
  if (
    code === "" ||
    name === "" ||
    !Number.isInteger(request.consumptionBaseQuantity) ||
    request.consumptionBaseQuantity <= 0
  ) {
    return failure(
      "VALIDATION_FAILED",
      "code, name, and positive consumptionBaseQuantity are required",
      request.requestId,
    );
  }

  const pool = await deps.db
    .prepare(
      `SELECT ip.id AS poolId, ip.base_unit_id AS baseUnitId, bu.dimension AS baseDimension
       FROM product p JOIN inventory_pool ip ON ip.id = p.inventory_pool_id
       JOIN unit bu ON bu.id = ip.base_unit_id
       WHERE p.id = ?`,
    )
    .bind(request.productId)
    .first<{ poolId: string; baseUnitId: string; baseDimension: string }>();
  if (!pool) return failure("NOT_FOUND", "Product not found", request.requestId);
  const sellableUnit = await deps.db
    .prepare("SELECT dimension FROM unit WHERE id = ?")
    .bind(request.sellableUnitId)
    .first<{ dimension: string }>();
  if (!sellableUnit)
    return failure("VALIDATION_FAILED", "Unknown sellable unit", request.requestId);
  if (sellableUnit.dimension !== pool.baseDimension) {
    return failure(
      "VALIDATION_FAILED",
      "Sellable unit dimension must match the product pool's base dimension",
      request.requestId,
    );
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.sku.create",
    request.idempotencyKey,
    {
      productId: request.productId,
      code,
      name,
      sellableUnitId: request.sellableUnitId,
      consumptionBaseQuantity: request.consumptionBaseQuantity,
      merchandisingLabel: request.merchandisingLabel ?? null,
      sortOrder: request.sortOrder ?? 0,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      return readSkuSummary(deps, claim.existing.resultReference, request.requestId);
    }
    return failure("CONFLICT", "The create command is still processing", request.requestId);
  }

  const skuId = crypto.randomUUID();
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          "INSERT INTO sku (id, product_id, code, name, sellable_unit_id, consumption_base_quantity, status, sort_order, merchandising_label, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)",
        )
        .bind(
          skuId,
          request.productId,
          code,
          name,
          request.sellableUnitId,
          request.consumptionBaseQuantity,
          request.sortOrder ?? 0,
          request.merchandisingLabel ?? null,
          now,
          now,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.SKU_CREATED",
        resourceType: "sku",
        resourceId: skuId,
        details: {
          code,
          productId: request.productId,
          consumptionBaseQuantity: request.consumptionBaseQuantity,
        },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, "admin.catalog.sku.create", request.idempotencyKey, skuId, now),
    ]);
  } catch (error) {
    log("error", "admin.catalog.sku_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, "admin.catalog.sku.create", request.idempotencyKey);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      return failure("CONFLICT", "A SKU with this code or name already exists", request.requestId);
    }
    return failure("CONFLICT", "The SKU could not be created", request.requestId);
  }

  return readSkuSummary(deps, skuId, request.requestId);
}

/** Update a SKU's display/ordering fields with a version guard. */
export async function updateAdminSku(
  deps: CatalogAdministrationDeps,
  request: AdminSkuUpdateRequest,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;

  const current = await deps.db
    .prepare("SELECT id, version FROM sku WHERE id = ?")
    .bind(request.skuId)
    .first<{ id: string; version: number }>();
  if (!current) return failure("NOT_FOUND", "SKU not found", request.requestId);

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.sku.update",
    request.idempotencyKey,
    {
      skuId: request.skuId,
      name: request.name ?? null,
      merchandisingLabel: request.merchandisingLabel ?? null,
      status: request.status ?? null,
      sortOrder: request.sortOrder ?? null,
      expectedVersion: request.expectedVersion,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readSkuSummary(deps, request.skuId, request.requestId);
    }
    return failure("CONFLICT", "The update command is still processing", request.requestId);
  }

  const updated = await deps.db
    .prepare(
      `UPDATE sku SET
         name = COALESCE(?, name),
         merchandising_label = COALESCE(?, merchandising_label),
         status = COALESCE(?, status),
         sort_order = COALESCE(?, sort_order),
         updated_at = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    )
    .bind(
      request.name ?? null,
      request.merchandisingLabel ?? null,
      request.status ?? null,
      request.sortOrder ?? null,
      now,
      request.skuId,
      request.expectedVersion,
    )
    .run();
  if ((updated.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, "admin.catalog.sku.update", request.idempotencyKey);
    return failure("STALE_VERSION", "SKU changed; refresh before retrying", request.requestId);
  }
  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "CATALOG.SKU_UPDATED",
      resourceType: "sku",
      resourceId: request.skuId,
      correlationId: request.requestId,
      occurredAt: now,
    }),
    idempotencyComplete(
      deps.db,
      "admin.catalog.sku.update",
      request.idempotencyKey,
      request.skuId,
      now,
    ),
  ]);
  return readSkuSummary(deps, request.skuId, request.requestId);
}

/** Upsert SKU availability for a location with a version guard. */
export async function setAdminSkuAvailability(
  deps: CatalogAdministrationDeps,
  request: AdminSkuAvailabilityRequest,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;

  const sku = await deps.db
    .prepare("SELECT id, version FROM sku WHERE id = ?")
    .bind(request.skuId)
    .first<{ id: string; version: number }>();
  if (!sku) return failure("NOT_FOUND", "SKU not found", request.requestId);

  const existing = await deps.db
    .prepare("SELECT version FROM sku_location_availability WHERE sku_id = ? AND location_id = ?")
    .bind(request.skuId, request.locationId)
    .first<{ version: number }>();

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.sku.availability",
    request.idempotencyKey,
    {
      skuId: request.skuId,
      locationId: request.locationId,
      availabilityStatus: request.availabilityStatus,
      sourcingMode: request.sourcingMode,
      expectedVersion: request.expectedVersion,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readSkuSummary(deps, request.skuId, request.requestId);
    }
    return failure("CONFLICT", "The availability command is still processing", request.requestId);
  }

  let changes = 0;
  if (existing) {
    const updated = await deps.db
      .prepare(
        "UPDATE sku_location_availability SET availability_status=?, sourcing_mode=?, version=version+1 WHERE sku_id=? AND location_id=? AND version=?",
      )
      .bind(
        request.availabilityStatus,
        request.sourcingMode,
        request.skuId,
        request.locationId,
        request.expectedVersion,
      )
      .run();
    changes = updated.meta?.changes ?? 0;
  } else {
    if (request.expectedVersion !== 0) {
      await idempotencyFailed(deps.db, "admin.catalog.sku.availability", request.idempotencyKey);
      return failure(
        "STALE_VERSION",
        "Availability row exists; refresh before retrying",
        request.requestId,
      );
    }
    const inserted = await deps.db
      .prepare(
        "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (?, ?, ?, ?, 1)",
      )
      .bind(request.skuId, request.locationId, request.availabilityStatus, request.sourcingMode)
      .run();
    changes = inserted.meta?.changes ?? 0;
  }
  if (changes !== 1) {
    await idempotencyFailed(deps.db, "admin.catalog.sku.availability", request.idempotencyKey);
    return failure(
      "STALE_VERSION",
      "Availability changed; refresh before retrying",
      request.requestId,
    );
  }
  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "CATALOG.SKU_AVAILABILITY_SET",
      resourceType: "sku_location_availability",
      resourceId: request.skuId,
      reason: request.locationId,
      before: {},
      after: { availabilityStatus: request.availabilityStatus, sourcingMode: request.sourcingMode },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    idempotencyComplete(
      deps.db,
      "admin.catalog.sku.availability",
      request.idempotencyKey,
      request.skuId,
      now,
    ),
  ]);
  return readSkuSummary(deps, request.skuId, request.requestId);
}

/**
 * Insert a new versioned STANDARD market price. History is never rewritten
 * and a zero amount fails closed.
 */
export async function setAdminSkuPrice(
  deps: CatalogAdministrationDeps,
  request: AdminSkuPriceRequest,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;

  if (!/^[A-Z]{3}$/.test(request.currency.trim())) {
    return failure("VALIDATION_FAILED", "currency must be an ISO 4217 code", request.requestId);
  }
  if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
    return failure(
      "VALIDATION_FAILED",
      "amountMinor must be a positive integer",
      request.requestId,
    );
  }
  const sku = await deps.db
    .prepare("SELECT id FROM sku WHERE id = ?")
    .bind(request.skuId)
    .first<{ id: string }>();
  if (!sku) return failure("NOT_FOUND", "SKU not found", request.requestId);
  const market = await deps.db
    .prepare("SELECT id FROM market WHERE id = ?")
    .bind(request.marketId)
    .first<{ id: string }>();
  if (!market) return failure("VALIDATION_FAILED", "Unknown market", request.requestId);

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.sku.price",
    request.idempotencyKey,
    {
      skuId: request.skuId,
      marketId: request.marketId,
      currency: request.currency.trim(),
      amountMinor: request.amountMinor,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readSkuSummary(deps, request.skuId, request.requestId);
    }
    return failure("CONFLICT", "The price command is still processing", request.requestId);
  }

  const priceId = crypto.randomUUID();
  const versionRow = await deps.db
    .prepare(
      "SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM price_version WHERE sku_id = ?",
    )
    .bind(request.skuId)
    .first<{ nextVersion: number }>();
  const nextVersion = versionRow?.nextVersion ?? 1;
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          "INSERT INTO price_version (id, sku_id, currency, amount_minor, valid_from, valid_to, version, created_at, market_id, location_id, price_type) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, 'STANDARD')",
        )
        .bind(
          priceId,
          request.skuId,
          request.currency.trim(),
          request.amountMinor,
          now,
          nextVersion,
          now,
          request.marketId,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.SKU_PRICE_SET",
        resourceType: "price_version",
        resourceId: priceId,
        details: {
          skuId: request.skuId,
          marketId: request.marketId,
          amountMinor: request.amountMinor,
          currency: request.currency.trim(),
        },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(
        deps.db,
        "admin.catalog.sku.price",
        request.idempotencyKey,
        request.skuId,
        now,
      ),
    ]);
  } catch (error) {
    log("error", "admin.catalog.price_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, "admin.catalog.sku.price", request.idempotencyKey);
    return failure("CONFLICT", "The price could not be recorded", request.requestId);
  }

  return readSkuSummary(deps, request.skuId, request.requestId);
}
