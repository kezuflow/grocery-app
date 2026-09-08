import type { AdminCatalogSkuSummary, AdminUnitSummary, RpcResult } from "@freshmarkets/contracts";
import {
  z,
  authenticatedRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  adminUnitCreateBodySchema,
  adminSkuCreateBodySchema,
  adminSkuUpdateBodySchema,
  adminSkuAvailabilityBodySchema,
  adminSkuPriceBodySchema,
  adminUnitSummarySchema,
  adminCatalogSkuSummarySchema,
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
} from "./catalog-administration-access";
import {
  catalogCommandFailure as failure,
  requireCatalogEffect as required,
  catalogCommandReceipt,
  executeCatalogCommand,
  type CatalogCommandIdentity,
} from "./catalog-command-recovery";

const meta = authenticatedRequestSchema.extend({ idempotencyKey: idempotencyKeySchema });
const unitSchema = meta.extend(adminUnitCreateBodySchema.shape);
const createSchema = meta.extend(adminSkuCreateBodySchema.shape);
const updateSchema = meta
  .extend(adminSkuUpdateBodySchema.shape)
  .extend({ skuId: identifierSchema });
const availabilitySchema = meta
  .extend(adminSkuAvailabilityBodySchema.shape)
  .extend({ skuId: identifierSchema });
const priceSchema = meta.extend(adminSkuPriceBodySchema.shape).extend({ skuId: identifierSchema });
function invalid(input: unknown) {
  const parsed = z.object({ requestId: identifierSchema }).safeParse(input);
  return failure(
    "VALIDATION_FAILED",
    "Check catalog fields, version and request key",
    parsed.success ? parsed.data.requestId : "unavailable",
  );
}
async function identity(
  scope: string,
  request: { idempotencyKey: string; requestId: string },
  body: unknown,
): Promise<CatalogCommandIdentity> {
  return {
    scope,
    key: request.idempotencyKey,
    requestId: request.requestId,
    hash: await requestHash(body),
  };
}
/** Freeze the result within the command transaction, using only its exact location when present. */
function skuReceipt(
  db: D1Database,
  command: CatalogCommandIdentity,
  skuId: string,
  now: number,
  locationId: string | null = null,
  priceId: string | null = null,
) {
  return db
    .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(
    SELECT json_object('skuId',s.id,'code',s.code,'name',s.name,'merchandisingLabel',s.merchandising_label,
      'unitSymbol',u.symbol,'sellQuantity',s.sell_quantity,'consumptionBaseQuantity',s.consumption_base_quantity,
      'estimatedShippingWeightGrams',s.estimated_shipping_weight_grams,'status',s.status,'sortOrder',s.sort_order,'version',s.version,
      'priceMinor',pv.amount_minor,'currency',pv.currency,'priceVersion',pv.version,
      'availability',a.availability_status,'availabilityVersion',a.version)
    FROM sku s JOIN unit u ON u.id=s.sellable_unit_id
    LEFT JOIN price_version pv ON pv.id=COALESCE(?,(SELECT p.id FROM price_version p
      WHERE p.sku_id=s.id AND p.location_id=? AND p.price_type='STANDARD' AND p.valid_from<=? AND (p.valid_to IS NULL OR p.valid_to>?)
      ORDER BY p.valid_from DESC,p.version DESC,p.id DESC LIMIT 1))
    LEFT JOIN sku_location_availability a ON a.sku_id=s.id AND a.location_id=? WHERE s.id=?),updated_at=?
    WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`)
    .bind(
      priceId,
      locationId,
      now,
      now,
      locationId,
      skuId,
      now,
      command.scope,
      command.key,
      command.hash,
    );
}

export async function createAdminUnit(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminUnitSummary>> {
  const parsed = unitSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const {
    code,
    displayName,
    dimension,
    canonicalBaseCode,
    conversionNumerator,
    conversionDenominator,
  } = request;
  if (dimension === "VOLUME" || (dimension === "MASS" ? "GRAM" : "PIECE") !== canonicalBaseCode)
    return failure(
      "VALIDATION_FAILED",
      "Use a same-dimension Gram or Piece conversion; volume units are retired",
      request.requestId,
    );
  const body = {
    code,
    displayName,
    dimension,
    canonicalBaseCode,
    conversionNumerator,
    conversionDenominator,
  };
  const command = await identity("admin.catalog.unit", request, body);
  const prior = await catalogCommandReceipt(deps.db, command, adminUnitSummarySchema);
  if (prior) return prior;
  const id = crypto.randomUUID(),
    now = Date.now();
  const result: AdminUnitSummary = { unitId: id, ...body, status: "active", version: 1 };
  return executeCatalogCommand(
    deps.db,
    command,
    access.value,
    "CATALOG.UNIT_CREATED",
    [
      deps.db
        .prepare(`INSERT INTO unit(id,code,name,dimension,symbol,canonical_base_code,conversion_numerator,conversion_denominator,status,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'active',1,?,?)`)
        .bind(
          id,
          code,
          displayName,
          dimension,
          code,
          canonicalBaseCode,
          conversionNumerator,
          conversionDenominator,
          now,
          now,
        ),
      required(deps.db),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.UNIT_CREATED",
        resourceType: "unit",
        resourceId: id,
        details: body,
        idempotencyKey: command.key,
        correlationId: command.requestId,
        occurredAt: now,
      }),
      required(deps.db),
    ],
    deps.db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(result), now, command.scope, command.key, command.hash),
    adminUnitSummarySchema,
  );
}

/** Shared eligibility is checked again within the SKU insert transaction. */
const variantEligibility = `SELECT 1 FROM product p JOIN inventory_pool pool ON pool.id=p.inventory_pool_id
  JOIN unit base ON base.id=pool.base_unit_id JOIN unit sell ON sell.id=?
  WHERE p.id=? AND p.status='active' AND base.status='active' AND sell.status='active'
  AND ((base.code='GRAM' AND base.dimension='MASS') OR (base.code='PIECE' AND base.dimension='COUNT'))
  AND base.code=base.canonical_base_code AND base.conversion_numerator=1 AND base.conversion_denominator=1
  AND sell.dimension=base.dimension AND sell.canonical_base_code=base.code
  AND ?*sell.conversion_numerator<=9007199254740991
  AND (?*sell.conversion_numerator)%sell.conversion_denominator=0
  AND (?*sell.conversion_numerator)/sell.conversion_denominator=?
  AND ((base.code='GRAM' AND ? IS NULL) OR (base.code='PIECE' AND ?>0))`;
export async function createAdminSku(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const { productId, code, name, sellableUnitId, sellQuantity, consumptionBaseQuantity } = request;
  const estimatedShippingWeightGrams = request.estimatedShippingWeightGrams ?? null;
  const merchandisingLabel = request.merchandisingLabel ?? null,
    sortOrder = request.sortOrder ?? 0;
  const body = {
    productId,
    code,
    name,
    sellableUnitId,
    sellQuantity,
    consumptionBaseQuantity,
    estimatedShippingWeightGrams,
    merchandisingLabel,
    sortOrder,
  };
  const command = await identity("admin.catalog.sku.create", request, body);
  const prior = await catalogCommandReceipt(deps.db, command, adminCatalogSkuSummarySchema);
  if (prior) return prior;
  if (!(await deps.db.prepare("SELECT id FROM product WHERE id=?").bind(productId).first()))
    return failure("NOT_FOUND", "Product not found", request.requestId);
  const binds = [
    sellableUnitId,
    productId,
    sellQuantity,
    sellQuantity,
    sellQuantity,
    consumptionBaseQuantity,
    estimatedShippingWeightGrams,
    estimatedShippingWeightGrams,
  ];
  if (
    !(await deps.db
      .prepare(variantEligibility)
      .bind(...binds)
      .first())
  )
    return failure(
      "VALIDATION_FAILED",
      "An active same-dimension unit must convert exactly to base consumption; Piece variants require shipping grams",
      request.requestId,
    );
  const id = crypto.randomUUID(),
    now = Date.now();
  return executeCatalogCommand(
    deps.db,
    command,
    access.value,
    "CATALOG.SKU_CREATED",
    [
      deps.db
        .prepare(
          `INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (${variantEligibility})`,
        )
        .bind(...binds),
      deps.db
        .prepare(`INSERT INTO sku(id,product_id,code,name,sellable_unit_id,sell_quantity,consumption_base_quantity,estimated_shipping_weight_grams,status,sort_order,merchandising_label,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'active',?,?,1,?,?)`)
        .bind(
          id,
          productId,
          code,
          name,
          sellableUnitId,
          sellQuantity,
          consumptionBaseQuantity,
          estimatedShippingWeightGrams,
          sortOrder,
          merchandisingLabel,
          now,
          now,
        ),
      required(deps.db),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.SKU_CREATED",
        resourceType: "sku",
        resourceId: id,
        details: body,
        idempotencyKey: command.key,
        correlationId: command.requestId,
        occurredAt: now,
      }),
      required(deps.db),
    ],
    skuReceipt(deps.db, command, id, now),
    adminCatalogSkuSummarySchema,
  );
}

export async function updateAdminSku(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const { skuId, expectedVersion } = request;
  const body = {
    skuId,
    name: request.name ?? null,
    merchandisingLabel: request.merchandisingLabel ?? null,
    status: request.status ?? null,
    sortOrder: request.sortOrder ?? null,
    estimatedShippingWeightGrams: request.estimatedShippingWeightGrams ?? "UNCHANGED",
    expectedVersion,
    // Explicit clearing is distinct from leaving the label unchanged.
    setMerchandisingLabel: request.merchandisingLabel !== undefined,
  };
  const command = await identity("admin.catalog.sku.update", request, body);
  const prior = await catalogCommandReceipt(deps.db, command, adminCatalogSkuSummarySchema);
  if (prior) return prior;
  const current = await deps.db
    .prepare("SELECT version FROM sku WHERE id=?")
    .bind(skuId)
    .first<{ version: number }>();
  if (!current) return failure("NOT_FOUND", "Variant not found", request.requestId);
  if (current.version !== expectedVersion)
    return failure("STALE_VERSION", "Variant changed; refresh before saving", request.requestId);
  const now = Date.now();
  const effects: D1PreparedStatement[] = [];
  if (request.estimatedShippingWeightGrams !== undefined)
    effects.push(
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
      SELECT 1 FROM sku s JOIN product p ON p.id=s.product_id JOIN inventory_pool pool ON pool.id=p.inventory_pool_id
      JOIN unit base ON base.id=pool.base_unit_id WHERE s.id=? AND base.code='PIECE' AND base.dimension='COUNT')`)
        .bind(skuId),
    );
  effects.push(
    deps.db
      .prepare(`UPDATE sku SET name=COALESCE(?,name),merchandising_label=CASE WHEN ? THEN ? ELSE merchandising_label END,
      status=COALESCE(?,status),sort_order=COALESCE(?,sort_order),estimated_shipping_weight_grams=COALESCE(?,estimated_shipping_weight_grams),updated_at=?,version=version+1 WHERE id=? AND version=?`)
      .bind(
        request.name ?? null,
        request.merchandisingLabel !== undefined ? 1 : 0,
        request.merchandisingLabel ?? null,
        request.status ?? null,
        request.sortOrder ?? null,
        request.estimatedShippingWeightGrams ?? null,
        now,
        skuId,
        expectedVersion,
      ),
    required(deps.db),
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "CATALOG.SKU_UPDATED",
      resourceType: "sku",
      resourceId: skuId,
      details: body,
      idempotencyKey: command.key,
      correlationId: command.requestId,
      occurredAt: now,
    }),
    required(deps.db),
  );
  return executeCatalogCommand(
    deps.db,
    command,
    access.value,
    "CATALOG.SKU_UPDATED",
    effects,
    skuReceipt(deps.db, command, skuId, now),
    adminCatalogSkuSummarySchema,
  );
}

export async function setAdminSkuAvailability(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(
    deps,
    request,
    "catalog.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  const { skuId, locationId, availabilityStatus, expectedVersion } = request;
  const body = { skuId, locationId, availabilityStatus, expectedVersion };
  const command = await identity("admin.catalog.sku.availability", request, body);
  const prior = await catalogCommandReceipt(deps.db, command, adminCatalogSkuSummarySchema);
  if (prior) return prior;
  if (!(await deps.db.prepare("SELECT id FROM sku WHERE id=?").bind(skuId).first()))
    return failure("NOT_FOUND", "Variant not found", request.requestId);
  if (
    !(await deps.db
      .prepare("SELECT id FROM fulfillment_location WHERE id=? AND status='active'")
      .bind(locationId)
      .first())
  )
    return failure("VALIDATION_FAILED", "Unknown or inactive location", request.requestId);
  const current = await deps.db
    .prepare("SELECT version FROM sku_location_availability WHERE sku_id=? AND location_id=?")
    .bind(skuId, locationId)
    .first<{ version: number }>();
  if ((current?.version ?? 0) !== expectedVersion)
    return failure(
      "STALE_VERSION",
      "Selling status changed; refresh before saving",
      request.requestId,
    );
  const now = Date.now();
  return executeCatalogCommand(
    deps.db,
    command,
    access.value,
    "CATALOG.SKU_AVAILABILITY_SET",
    [
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (SELECT 1 FROM fulfillment_location WHERE id=? AND status='active')",
        )
        .bind(locationId),
      current
        ? deps.db
            .prepare(
              "UPDATE sku_location_availability SET availability_status=?,version=version+1 WHERE sku_id=? AND location_id=? AND version=?",
            )
            .bind(availabilityStatus, skuId, locationId, expectedVersion)
        : deps.db
            .prepare(
              "INSERT INTO sku_location_availability(sku_id,location_id,availability_status,version) VALUES (?,?,?,1)",
            )
            .bind(skuId, locationId, availabilityStatus),
      required(deps.db),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.SKU_AVAILABILITY_SET",
        resourceType: "sku_location_availability",
        resourceId: skuId,
        locationId,
        details: body,
        idempotencyKey: command.key,
        correlationId: command.requestId,
        occurredAt: now,
      }),
      required(deps.db),
    ],
    skuReceipt(deps.db, command, skuId, now, locationId),
    adminCatalogSkuSummarySchema,
    { capability: "catalog.manage", locationId },
  );
}

/** Close exactly the reviewed successor and preserve every earlier price interval. */
export async function setAdminSkuPrice(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminCatalogSkuSummary>> {
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "prices.manage");
  if (!access.ok) return access;
  const { skuId, marketId, locationId, currency, amountMinor, validFrom, expectedVersion } =
    request;
  const body = { skuId, marketId, locationId, currency, amountMinor, validFrom, expectedVersion };
  const command = await identity("admin.catalog.sku.price", request, body);
  const prior = await catalogCommandReceipt(deps.db, command, adminCatalogSkuSummarySchema);
  if (prior) return prior;
  if (!(await deps.db.prepare("SELECT id FROM sku WHERE id=?").bind(skuId).first()))
    return failure("NOT_FOUND", "Variant not found", request.requestId);
  const locationGuard = `SELECT 1 FROM fulfillment_location location JOIN market ON market.id=location.market_id
    WHERE location.id=? AND location.market_id=? AND location.status='active' AND market.status='active' AND market.currency=?`;
  if (!(await deps.db.prepare(locationGuard).bind(locationId, marketId, currency).first()))
    return failure(
      "VALIDATION_FAILED",
      "Choose an active location and its market currency",
      request.requestId,
    );
  const current = await deps.db
    .prepare(
      "SELECT id,version,valid_from validFrom FROM price_version WHERE sku_id=? AND location_id=? AND price_type='STANDARD' AND valid_to IS NULL ORDER BY valid_from DESC,version DESC LIMIT 1",
    )
    .bind(skuId, locationId)
    .first<{ id: string; version: number; validFrom: number }>();
  if ((current?.version ?? 0) !== expectedVersion)
    return failure("STALE_VERSION", "Price changed; refresh before saving", request.requestId);
  if (current && validFrom <= current.validFrom)
    return failure(
      "VALIDATION_FAILED",
      "Effective time must follow the latest price start",
      request.requestId,
    );
  const id = crypto.randomUUID(),
    now = Date.now();
  const effects: D1PreparedStatement[] = [
    deps.db
      .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (${locationGuard})`)
      .bind(locationId, marketId, currency),
  ];
  if (current)
    effects.push(
      deps.db
        .prepare(
          "UPDATE price_version SET valid_to=? WHERE id=? AND version=? AND valid_to IS NULL AND valid_from<?",
        )
        .bind(validFrom, current.id, expectedVersion, validFrom),
      required(deps.db),
    );
  else
    effects.push(
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM price_version WHERE sku_id=? AND location_id=? AND price_type='STANDARD' AND valid_to IS NULL)",
        )
        .bind(skuId, locationId),
    );
  effects.push(
    deps.db
      .prepare(`INSERT INTO price_version(id,sku_id,currency,amount_minor,valid_from,valid_to,version,created_at,market_id,location_id,price_type)
      SELECT ?,?,?,?,?,NULL,COALESCE(MAX(version),0)+1,?,?,?,'STANDARD' FROM price_version WHERE sku_id=?`)
      .bind(id, skuId, currency, amountMinor, validFrom, now, marketId, locationId, skuId),
    required(deps.db),
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "CATALOG.SKU_PRICE_SET",
      resourceType: "price_version",
      resourceId: id,
      locationId,
      details: body,
      idempotencyKey: command.key,
      correlationId: command.requestId,
      occurredAt: now,
    }),
    required(deps.db),
  );
  return executeCatalogCommand(
    deps.db,
    command,
    access.value,
    "CATALOG.SKU_PRICE_SET",
    effects,
    skuReceipt(deps.db, command, skuId, now, locationId, id),
    adminCatalogSkuSummarySchema,
    { capability: "prices.manage" },
  );
}
export {
  createAdminCategory,
  updateAdminCategory,
  setAdminCategoryStatus,
} from "./category-commands";
export { createAdminProduct, updateAdminProduct, setAdminProductStatus } from "./product-commands";
