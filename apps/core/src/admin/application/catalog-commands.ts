import type {
  AdminCatalogSkuSummary,
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

/** Create a controlled unit with an exact conversion to its dimension's canonical base. */
export async function createAdminUnit(
  deps: CatalogAdministrationDeps,
  request: AdminUnitCreateRequest,
): Promise<RpcResult<AdminUnitSummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;

  const code = request.code.trim().toUpperCase();
  const displayName = request.displayName.trim();
  if (request.dimension === "VOLUME")
    return failure(
      "VALIDATION_FAILED",
      "Volume units are not enabled; packaged liquids must be configured as count-based products",
      request.requestId,
    );
  const requiredBaseByDimension = {
    MASS: "GRAM",
    COUNT: "PIECE",
    VOLUME: "MILLILITER",
  } as const;
  if (
    !/^[A-Z][A-Z0-9_]*$/.test(code) ||
    displayName === "" ||
    requiredBaseByDimension[request.dimension] !== request.canonicalBaseCode ||
    !Number.isSafeInteger(request.conversionNumerator) ||
    request.conversionNumerator <= 0 ||
    !Number.isSafeInteger(request.conversionDenominator) ||
    request.conversionDenominator <= 0
  ) {
    return failure(
      "VALIDATION_FAILED",
      "A valid code, display name, same-dimension canonical base, and positive exact conversion are required",
      request.requestId,
    );
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.unit",
    request.idempotencyKey,
    {
      code,
      displayName,
      dimension: request.dimension,
      canonicalBaseCode: request.canonicalBaseCode,
      conversionNumerator: request.conversionNumerator,
      conversionDenominator: request.conversionDenominator,
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
          `SELECT id AS unitId, code, name AS displayName, dimension,
                  canonical_base_code AS canonicalBaseCode,
                  conversion_numerator AS conversionNumerator,
                  conversion_denominator AS conversionDenominator,
                  status, version FROM unit WHERE id = ?`,
        )
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
          `INSERT INTO unit
             (id, code, name, dimension, symbol, canonical_base_code,
              conversion_numerator, conversion_denominator, status, version,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
        )
        .bind(
          unitId,
          code,
          displayName,
          request.dimension,
          code,
          request.canonicalBaseCode,
          request.conversionNumerator,
          request.conversionDenominator,
          now,
          now,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.UNIT_CREATED",
        resourceType: "unit",
        resourceId: unitId,
        details: {
          code,
          dimension: request.dimension,
          canonicalBaseCode: request.canonicalBaseCode,
          conversionNumerator: request.conversionNumerator,
          conversionDenominator: request.conversionDenominator,
        },
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
    .prepare(
      `SELECT id AS unitId, code, name AS displayName, dimension,
              canonical_base_code AS canonicalBaseCode,
              conversion_numerator AS conversionNumerator,
              conversion_denominator AS conversionDenominator,
              status, version FROM unit WHERE id = ?`,
    )
    .bind(unitId)
    .first<AdminUnitSummary>();
  if (!created) {
    return failure("INTERNAL_ERROR", "The unit could not be read back", request.requestId);
  }
  return { ok: true, value: created, requestId: request.requestId };
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
  const estimatedShippingWeightGrams = request.estimatedShippingWeightGrams ?? null;
  if (
    code === "" ||
    name === "" ||
    !Number.isSafeInteger(request.sellQuantity) ||
    request.sellQuantity <= 0 ||
    !Number.isSafeInteger(request.consumptionBaseQuantity) ||
    request.consumptionBaseQuantity <= 0 ||
    (estimatedShippingWeightGrams !== null &&
      (!Number.isSafeInteger(estimatedShippingWeightGrams) || estimatedShippingWeightGrams <= 0))
  ) {
    return failure(
      "VALIDATION_FAILED",
      "code, name, positive sellQuantity, and positive consumptionBaseQuantity are required",
      request.requestId,
    );
  }

  const pool = await deps.db
    .prepare(
      `SELECT ip.id AS poolId, ip.base_unit_id AS baseUnitId, bu.dimension AS baseDimension,
              bu.canonical_base_code AS baseUnitCode
       FROM product p JOIN inventory_pool ip ON ip.id = p.inventory_pool_id
       JOIN unit bu ON bu.id = ip.base_unit_id
       WHERE p.id = ?`,
    )
    .bind(request.productId)
    .first<{
      poolId: string;
      baseUnitId: string;
      baseDimension: string;
      baseUnitCode: "GRAM" | "MILLILITER" | "PIECE";
    }>();
  if (!pool) return failure("NOT_FOUND", "Product not found", request.requestId);
  if (pool.baseUnitCode !== "GRAM" && estimatedShippingWeightGrams === null)
    return failure(
      "VALIDATION_FAILED",
      "A positive estimated shipping weight in grams is required for non-gram variants",
      request.requestId,
    );
  if (pool.baseUnitCode === "GRAM" && estimatedShippingWeightGrams !== null)
    return failure(
      "VALIDATION_FAILED",
      "Gram-based variants derive shipping weight from base consumption",
      request.requestId,
    );
  const sellableUnit = await deps.db
    .prepare(
      `SELECT dimension, conversion_numerator AS conversionNumerator,
              conversion_denominator AS conversionDenominator, status
       FROM unit WHERE id = ?`,
    )
    .bind(request.sellableUnitId)
    .first<{
      dimension: string;
      conversionNumerator: number;
      conversionDenominator: number;
      status: "active" | "inactive";
    }>();
  if (!sellableUnit)
    return failure("VALIDATION_FAILED", "Unknown sellable unit", request.requestId);
  if (sellableUnit.dimension !== pool.baseDimension) {
    return failure(
      "VALIDATION_FAILED",
      "Sellable unit dimension must match the product pool's base dimension",
      request.requestId,
    );
  }
  const convertedNumerator = request.sellQuantity * sellableUnit.conversionNumerator;
  if (
    sellableUnit.status !== "active" ||
    !Number.isSafeInteger(convertedNumerator) ||
    convertedNumerator % sellableUnit.conversionDenominator !== 0 ||
    convertedNumerator / sellableUnit.conversionDenominator !== request.consumptionBaseQuantity
  ) {
    return failure(
      "VALIDATION_FAILED",
      "Sell quantity must convert exactly to the declared base consumption using an active unit",
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
      sellQuantity: request.sellQuantity,
      consumptionBaseQuantity: request.consumptionBaseQuantity,
      estimatedShippingWeightGrams,
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
          "INSERT INTO sku (id, product_id, code, name, sellable_unit_id, sell_quantity, consumption_base_quantity, estimated_shipping_weight_grams, status, sort_order, merchandising_label, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)",
        )
        .bind(
          skuId,
          request.productId,
          code,
          name,
          request.sellableUnitId,
          request.sellQuantity,
          request.consumptionBaseQuantity,
          estimatedShippingWeightGrams,
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
          sellQuantity: request.sellQuantity,
          consumptionBaseQuantity: request.consumptionBaseQuantity,
          estimatedShippingWeightGrams,
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
  if (
    request.estimatedShippingWeightGrams !== undefined &&
    (!Number.isSafeInteger(request.estimatedShippingWeightGrams) ||
      request.estimatedShippingWeightGrams <= 0)
  )
    return failure(
      "VALIDATION_FAILED",
      "Estimated shipping weight must be a positive integer number of grams",
      request.requestId,
    );
  if (request.estimatedShippingWeightGrams !== undefined) {
    const baseUnit = await deps.db
      .prepare(
        `SELECT bu.canonical_base_code AS baseUnitCode
         FROM sku s JOIN product p ON p.id=s.product_id
         JOIN inventory_pool ip ON ip.id=p.inventory_pool_id
         JOIN unit bu ON bu.id=ip.base_unit_id WHERE s.id=?`,
      )
      .bind(request.skuId)
      .first<{ baseUnitCode: "GRAM" | "MILLILITER" | "PIECE" }>();
    if (baseUnit?.baseUnitCode === "GRAM")
      return failure(
        "VALIDATION_FAILED",
        "Gram-based variants derive shipping weight from base consumption",
        request.requestId,
      );
  }

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
      estimatedShippingWeightGrams:
        request.estimatedShippingWeightGrams === undefined
          ? "UNCHANGED"
          : request.estimatedShippingWeightGrams,
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

  try {
    await deps.db.batch([
      deps.db
        .prepare(
          `UPDATE sku SET
             name = COALESCE(?, name),
             merchandising_label = COALESCE(?, merchandising_label),
             status = COALESCE(?, status),
             sort_order = COALESCE(?, sort_order),
             estimated_shipping_weight_grams = CASE WHEN ? THEN ? ELSE estimated_shipping_weight_grams END,
             updated_at = ?, version = version + 1
           WHERE id = ? AND version = ?`,
        )
        .bind(
          request.name ?? null,
          request.merchandisingLabel ?? null,
          request.status ?? null,
          request.sortOrder ?? null,
          request.estimatedShippingWeightGrams === undefined ? 0 : 1,
          request.estimatedShippingWeightGrams ?? null,
          now,
          request.skuId,
          request.expectedVersion,
        ),
      deps.db.prepare("INSERT INTO admin_command_abort (id) SELECT -1 WHERE changes()=0"),
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
  } catch {
    await idempotencyFailed(deps.db, "admin.catalog.sku.update", request.idempotencyKey);
    return failure("STALE_VERSION", "SKU changed; refresh before retrying", request.requestId);
  }
  return readSkuSummary(deps, request.skuId, request.requestId);
}

/** Upsert SKU availability for a location with a version guard. */
export async function setAdminSkuAvailability(
  deps: CatalogAdministrationDeps,
  request: AdminSkuAvailabilityRequest,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const access = await resolveCatalogAdministrationAccess(
    deps,
    request,
    "catalog.manage",
    request.locationId,
  );
  if (!access.ok) return access;

  const sku = await deps.db
    .prepare("SELECT id, version FROM sku WHERE id = ?")
    .bind(request.skuId)
    .first<{ id: string; version: number }>();
  if (!sku) return failure("NOT_FOUND", "SKU not found", request.requestId);
  const location = await deps.db
    .prepare("SELECT id FROM fulfillment_location WHERE id=? AND status='active'")
    .bind(request.locationId)
    .first<{ id: string }>();
  if (!location)
    return failure("VALIDATION_FAILED", "Unknown or inactive location", request.requestId);

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

  if (!existing) {
    if (request.expectedVersion !== 0) {
      await idempotencyFailed(deps.db, "admin.catalog.sku.availability", request.idempotencyKey);
      return failure(
        "STALE_VERSION",
        "Availability row exists; refresh before retrying",
        request.requestId,
      );
    }
  }
  try {
    const write = existing
      ? deps.db
          .prepare(
            "UPDATE sku_location_availability SET availability_status=?, version=version+1 WHERE sku_id=? AND location_id=? AND version=?",
          )
          .bind(
            request.availabilityStatus,
            request.skuId,
            request.locationId,
            request.expectedVersion,
          )
      : deps.db
          .prepare(
            "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, version) VALUES (?, ?, ?, 1)",
          )
          .bind(request.skuId, request.locationId, request.availabilityStatus);
    await deps.db.batch([
      write,
      deps.db.prepare("INSERT INTO admin_command_abort (id) SELECT -1 WHERE changes()=0"),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.SKU_AVAILABILITY_SET",
        resourceType: "sku_location_availability",
        resourceId: request.skuId,
        reason: request.locationId,
        before: existing ? { version: existing.version } : {},
        after: {
          availabilityStatus: request.availabilityStatus,
          version: (existing?.version ?? 0) + 1,
        },
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
  } catch {
    await idempotencyFailed(deps.db, "admin.catalog.sku.availability", request.idempotencyKey);
    return failure(
      "STALE_VERSION",
      "Availability changed; refresh before retrying",
      request.requestId,
    );
  }
  return readSkuSummary(deps, request.skuId, request.requestId);
}

/** Close the current effective row and insert its guarded STANDARD successor. */
export async function setAdminSkuPrice(
  deps: CatalogAdministrationDeps,
  request: AdminSkuPriceRequest,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "prices.manage");
  if (!access.ok) return access;

  const currency = request.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return failure("VALIDATION_FAILED", "currency must be an ISO 4217 code", request.requestId);
  }
  if (
    !Number.isSafeInteger(request.amountMinor) ||
    request.amountMinor <= 0 ||
    !Number.isSafeInteger(request.validFrom) ||
    request.validFrom <= 0 ||
    !Number.isSafeInteger(request.expectedVersion) ||
    request.expectedVersion < 0
  ) {
    return failure(
      "VALIDATION_FAILED",
      "amountMinor, validFrom, and expectedVersion must be valid positive integer values",
      request.requestId,
    );
  }
  const sku = await deps.db
    .prepare("SELECT id FROM sku WHERE id = ?")
    .bind(request.skuId)
    .first<{ id: string }>();
  if (!sku) return failure("NOT_FOUND", "SKU not found", request.requestId);
  const market = await deps.db
    .prepare("SELECT id, currency, status FROM market WHERE id = ?")
    .bind(request.marketId)
    .first<{ id: string; currency: string; status: "active" | "inactive" }>();
  if (!market || market.status !== "active")
    return failure("VALIDATION_FAILED", "Unknown or inactive market", request.requestId);
  if (currency !== market.currency)
    return failure(
      "VALIDATION_FAILED",
      "currency must match the market currency",
      request.requestId,
    );
  const location = await deps.db
    .prepare("SELECT id FROM fulfillment_location WHERE id=? AND market_id=? AND status='active'")
    .bind(request.locationId, request.marketId)
    .first<{ id: string }>();
  if (!location)
    return failure(
      "VALIDATION_FAILED",
      "Location must be active and belong to the selected market",
      request.requestId,
    );

  const current = await deps.db
    .prepare(
      `SELECT id, version, valid_from AS validFrom
       FROM price_version
       WHERE sku_id=? AND market_id=? AND location_id IS ?
         AND price_type='STANDARD' AND valid_to IS NULL
       ORDER BY valid_from DESC, version DESC LIMIT 1`,
    )
    .bind(request.skuId, request.marketId, request.locationId)
    .first<{ id: string; version: number; validFrom: number }>();
  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.catalog.sku.price",
    request.idempotencyKey,
    {
      skuId: request.skuId,
      marketId: request.marketId,
      locationId: request.locationId,
      currency,
      amountMinor: request.amountMinor,
      validFrom: request.validFrom,
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
    return failure("CONFLICT", "The price command is still processing", request.requestId);
  }
  if ((current?.version ?? 0) !== request.expectedVersion) {
    await idempotencyFailed(deps.db, "admin.catalog.sku.price", request.idempotencyKey);
    return failure("STALE_VERSION", "Price changed; refresh before retrying", request.requestId);
  }
  if (current && request.validFrom <= current.validFrom) {
    await idempotencyFailed(deps.db, "admin.catalog.sku.price", request.idempotencyKey);
    return failure(
      "VALIDATION_FAILED",
      "validFrom must be later than the current price start",
      request.requestId,
    );
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
    const statements: D1PreparedStatement[] = [
      deps.db
        .prepare(`INSERT INTO admin_command_abort (id)
        SELECT -1 WHERE NOT EXISTS (
          SELECT 1 FROM staff_identity staff
          WHERE staff.id=? AND staff.status='active'
            AND EXISTS (SELECT 1 FROM staff_scope WHERE staff_id=staff.id AND scope_kind='global')
            AND EXISTS (SELECT 1 FROM staff_role sr
              JOIN role_permission rp ON rp.role_id=sr.role_id
              JOIN permission permission ON permission.id=rp.permission_id
              WHERE sr.staff_id=staff.id AND permission.code='prices.manage')
        ) OR NOT EXISTS (
          SELECT 1 FROM fulfillment_location location JOIN market ON market.id=location.market_id
          WHERE location.id=? AND location.market_id=? AND location.status='active'
            AND market.status='active' AND market.currency=?
        )`)
        .bind(access.value.staffId, request.locationId, request.marketId, currency),
    ];
    if (current) {
      statements.push(
        deps.db
          .prepare(
            "UPDATE price_version SET valid_to=? WHERE id=? AND version=? AND valid_to IS NULL AND valid_from < ?",
          )
          .bind(request.validFrom, current.id, request.expectedVersion, request.validFrom),
        deps.db.prepare("INSERT INTO admin_command_abort (id) SELECT -1 WHERE changes()=0"),
      );
    }
    statements.push(
      deps.db
        .prepare(
          "INSERT INTO price_version (id, sku_id, currency, amount_minor, valid_from, valid_to, version, created_at, market_id, location_id, price_type) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'STANDARD')",
        )
        .bind(
          priceId,
          request.skuId,
          currency,
          request.amountMinor,
          request.validFrom,
          nextVersion,
          now,
          request.marketId,
          request.locationId,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.SKU_PRICE_SET",
        resourceType: "price_version",
        resourceId: priceId,
        details: {
          skuId: request.skuId,
          marketId: request.marketId,
          locationId: request.locationId,
          amountMinor: request.amountMinor,
          currency,
          validFrom: request.validFrom,
          previousVersion: current?.version ?? null,
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
    );
    await deps.db.batch(statements);
  } catch (error) {
    log("error", "admin.catalog.price_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, "admin.catalog.sku.price", request.idempotencyKey);
    const winner = await deps.db
      .prepare(
        `SELECT version FROM price_version
         WHERE sku_id=? AND market_id=? AND location_id IS ?
           AND price_type='STANDARD' AND valid_to IS NULL
         ORDER BY valid_from DESC, version DESC LIMIT 1`,
      )
      .bind(request.skuId, request.marketId, request.locationId)
      .first<{ version: number }>();
    if ((winner?.version ?? 0) !== request.expectedVersion)
      return failure("STALE_VERSION", "Price changed; refresh before retrying", request.requestId);
    return failure("CONFLICT", "The price could not be recorded", request.requestId);
  }

  return readSkuSummary(deps, request.skuId, request.requestId);
}
export {
  createAdminCategory,
  updateAdminCategory,
  setAdminCategoryStatus,
} from "./category-commands";
export { createAdminProduct, updateAdminProduct, setAdminProductStatus } from "./product-commands";
