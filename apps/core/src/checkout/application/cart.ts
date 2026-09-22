import type {
  AuthenticatedRequest,
  CartView,
  ReorderResultView,
  ReorderSkippedReason,
  SetCartItemRequest,
} from "@freshmarkets/contracts";
import type { AppErrorCode } from "@freshmarkets/contracts";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { log } from "../../observability";
import { evaluateCheckoutPromotions } from "../../promotions/application/evaluate-checkout-promotions";
import {
  productMediaProjectionSql,
  publishedProductMediaView,
} from "../../catalog/published-product-media";
import {
  CHECKOUT_PAYMENT_IN_PROGRESS_REASON,
  cartHasUnsettledCheckout,
  cartMutationPaymentGuard,
} from "./release-uncommitted-checkout";

const CART_SET_SCOPE = "cart.setItem";
const CART_BATCH_SCOPE = "cart.addBatch";

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function failure(
  code: AppErrorCode,
  message: string,
  requestId: string,
  details?: Readonly<Record<string, string>>,
) {
  return { ok: false as const, error: { code, message, requestId, details } };
}

function paymentInProgressFailure(requestId: string) {
  return failure(
    "CONFLICT",
    "This cart is locked while its payment is being confirmed.",
    requestId,
    { reason: CHECKOUT_PAYMENT_IN_PROGRESS_REASON },
  );
}

export type CartResult =
  | { ok: true; value: CartView; requestId: string }
  | ReturnType<typeof failure>;

type CartRow = { id: string; location_id: string; version: number };

async function activeCart(database: D1Database, customerId: string): Promise<CartRow | null> {
  return database
    .prepare(
      "SELECT id, location_id, version FROM cart WHERE customer_id=? AND status='ACTIVE' LIMIT 1",
    )
    .bind(customerId)
    .first<CartRow>();
}

/** Read the customer's Cart after an explicit delivery-location selection. */
export async function getCart(
  database: D1Database,
  input: AuthenticatedRequest & { customerId: string },
): Promise<CartResult> {
  const startedAt = performance.now();
  const cart = await activeCart(database, input.customerId);
  const cartLookupMs = elapsedMs(startedAt);
  if (!cart) {
    return failure(
      "DELIVERY_LOCATION_REQUIRED",
      "Choose a delivery address to start your cart.",
      input.requestId,
    );
  }

  const marketStartedAt = performance.now();
  const currency = await database
    .prepare(
      "SELECT COALESCE(mcp.currency, m.currency) AS currency,m.id marketId,configuration.fulfillment_mode fulfillmentMode FROM fulfillment_location fl JOIN market m ON m.id=fl.market_id LEFT JOIN market_commerce_policy mcp ON mcp.market_id=m.id LEFT JOIN global_commerce_configuration configuration ON configuration.id='global' WHERE fl.id=?",
    )
    .bind(cart.location_id)
    .first<{
      currency: string;
      marketId: string;
      fulfillmentMode: "INSTANT" | "SCHEDULED" | null;
    }>();
  const marketMs = elapsedMs(marketStartedAt);
  if (!currency)
    return failure(
      "CONFIGURATION_ERROR",
      "Cart market currency is not configured",
      input.requestId,
    );

  const now = Date.now();
  const linesStartedAt = performance.now();
  const rows = await database
    .prepare(
      `SELECT ci.sku_id, ci.quantity, p.name || ' · ' || s.name AS name,p.id product_id,p.category_id,
         ${productMediaProjectionSql} AS media_json,
         s.status AS sku_status, p.status AS product_status, sla.availability_status,
         CAST(MAX(0,
           COALESCE((SELECT b.on_hand-b.reserved FROM inventory_balance b
             WHERE b.location_id=c.location_id
               AND b.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id)),0)
           - COALESCE((SELECT SUM(h.quantity) FROM checkout_inventory_holds h
             WHERE h.location_id=c.location_id
               AND h.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id)
               AND h.status='HELD'),0)
         ) / s.consumption_base_quantity AS INTEGER) AS available_quantity,
         (
           SELECT pv.amount_minor
           FROM price_version pv
           JOIN fulfillment_location price_location ON price_location.id=c.location_id
           WHERE pv.sku_id=s.id
             AND pv.market_id=price_location.market_id
             AND pv.currency=? AND pv.price_type='STANDARD'
             AND pv.location_id=c.location_id
             AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
           ORDER BY pv.version DESC LIMIT 1
         ) AS unit_price_minor
       FROM cart_item ci
       JOIN sku s ON s.id=ci.sku_id
       JOIN product p ON p.id=s.product_id
       JOIN cart c ON c.id=ci.cart_id
       LEFT JOIN sku_location_availability sla
         ON sla.sku_id=s.id AND sla.location_id=c.location_id
       WHERE ci.cart_id=? ORDER BY s.sort_order, s.id`,
    )
    .bind(currency.currency, now, now, cart.id)
    .all<{
      sku_id: string;
      quantity: number;
      name: string;
      media_json: string | null;
      sku_status: string;
      product_status: string;
      availability_status: string | null;
      unit_price_minor: number | null;
      available_quantity: number;
      product_id: string;
      category_id: string;
    }>();
  const linesMs = elapsedMs(linesStartedAt);

  const projectionStartedAt = performance.now();
  const items: CartView["items"][number][] = rows.results.map((row) => {
    const unavailableReason: CartView["items"][number]["unavailableReason"] =
      row.sku_status !== "active" ||
      row.product_status !== "active" ||
      row.availability_status !== "AVAILABLE"
        ? "NOT_SOLD_AT_LOCATION"
        : row.unit_price_minor === null
          ? "PRICE_UNAVAILABLE"
          : currency.fulfillmentMode === "INSTANT" && row.available_quantity < row.quantity
            ? "INSUFFICIENT_QUANTITY"
            : null;
    const availability =
      unavailableReason === "PRICE_UNAVAILABLE"
        ? "PRICE_UNAVAILABLE"
        : unavailableReason
          ? "UNAVAILABLE"
          : "AVAILABLE";
    const unitPriceMinor = availability === "AVAILABLE" ? row.unit_price_minor : null;
    return {
      skuId: row.sku_id,
      quantity: row.quantity,
      name: row.name,
      media: publishedProductMediaView(row.media_json),
      availability,
      unavailableReason,
      availableQuantity:
        unavailableReason === "INSUFFICIENT_QUANTITY" ? row.available_quantity : null,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor === null ? null : row.quantity * unitPriceMinor,
    };
  });
  const projectionMs = elapsedMs(projectionStartedAt);
  const promotionsStartedAt = performance.now();
  if (currency.fulfillmentMode) {
    const evaluated = await evaluateCheckoutPromotions(database, {
      customerId: input.customerId,
      marketId: currency.marketId,
      locationId: cart.location_id,
      fulfillmentMode: currency.fulfillmentMode,
      cartId: cart.id,
      at: now,
      merchandiseSubtotalMinor: items.reduce((sum, item) => sum + (item.lineTotalMinor ?? 0), 0),
      deliverySubtotalMinor: 0,
      requestedCodes: [],
      lineFacts: rows.results
        .filter((row) =>
          items.some((item) => item.skuId === row.sku_id && item.availability === "AVAILABLE"),
        )
        .map((row) => ({
          skuId: row.sku_id,
          productId: row.product_id,
          categoryId: row.category_id,
          quantity: row.quantity,
          lineSubtotalMinor: row.quantity * row.unit_price_minor!,
        })),
    });
    for (const application of evaluated.applications) {
      if (application.kind !== "PRODUCT_SALE") continue;
      for (const line of application.lines ?? []) {
        const item = items.find((candidate) => candidate.skuId === line.skuId);
        if (item?.lineTotalMinor != null) {
          item.regularLineTotalMinor = item.lineTotalMinor;
          item.lineTotalMinor -= line.amountMinor;
        }
      }
    }
  }
  const promotionsMs = elapsedMs(promotionsStartedAt);
  const blockingReasons = [
    ...(items.some((item) => item.availability === "UNAVAILABLE")
      ? (["ITEM_UNAVAILABLE"] as const)
      : []),
    ...(items.some((item) => item.availability === "PRICE_UNAVAILABLE")
      ? (["PRICE_UNAVAILABLE"] as const)
      : []),
  ];
  const paymentGuardStartedAt = performance.now();
  const paymentInProgress = await cartHasUnsettledCheckout(database, cart.id);
  const paymentGuardMs = elapsedMs(paymentGuardStartedAt);
  log("info", "cart.read.completed", {
    requestId: input.requestId,
    totalMs: elapsedMs(startedAt),
    cartLookupMs,
    marketMs,
    linesMs,
    projectionMs,
    promotionsMs,
    paymentGuardMs,
  });
  return {
    ok: true,
    value: {
      id: cart.id,
      locationId: cart.location_id,
      version: cart.version,
      items,
      totalMinor: items.reduce((sum, item) => sum + (item.lineTotalMinor ?? 0), 0),
      currency: currency.currency,
      paymentInProgress,
      checkoutBlocked: blockingReasons.length > 0,
      blockingReasons,
    },
    requestId: input.requestId,
  };
}

/** Set one line under a durable idempotency claim and aggregate-version CAS. */
export async function setCartItem(
  database: D1Database,
  command: SetCartItemRequest & { customerId: string },
): Promise<CartResult> {
  const startedAt = performance.now();
  const hash = await requestHash({
    cartId: command.cartId,
    skuId: command.skuId,
    quantity: command.quantity,
    expectedVersion: command.expectedVersion,
  });
  const hashMs = elapsedMs(startedAt);
  const idempotencyStartedAt = performance.now();
  const existing = await findIdempotencyRecord(database, CART_SET_SCOPE, command.idempotencyKey);
  const idempotencyMs = elapsedMs(idempotencyStartedAt);
  if (existing) {
    if (existing.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for another cart command",
        command.requestId,
      );
    if (existing.status === "SUCCEEDED") return getCart(database, command);
    return failure("CONFLICT", "The cart command is already being processed", command.requestId);
  }

  const cartLookupStartedAt = performance.now();
  const cart = await database
    .prepare(
      "SELECT id, location_id, version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'",
    )
    .bind(command.cartId, command.customerId)
    .first<CartRow>();
  const cartLookupMs = elapsedMs(cartLookupStartedAt);
  if (!cart) return failure("NOT_FOUND", "Active cart not found", command.requestId);
  const paymentGuardStartedAt = performance.now();
  if (await cartHasUnsettledCheckout(database, cart.id))
    return paymentInProgressFailure(command.requestId);
  const paymentGuardMs = elapsedMs(paymentGuardStartedAt);
  if (cart.version !== command.expectedVersion)
    return failure(
      "CART_VERSION_CONFLICT",
      "The cart changed; reload it before updating",
      command.requestId,
    );

  const lineLookupStartedAt = performance.now();
  const existingLine = await database
    .prepare("SELECT quantity FROM cart_item WHERE cart_id=? AND sku_id=?")
    .bind(cart.id, command.skuId)
    .first<{ quantity: number }>();
  const lineLookupMs = elapsedMs(lineLookupStartedAt);
  const validationStartedAt = performance.now();
  if (command.quantity > (existingLine?.quantity ?? 0)) {
    const now = Date.now();
    const sku = await database
      .prepare(
        `SELECT s.id, s.status AS sku_status, p.status AS product_status,
           sla.availability_status,
           (
             SELECT pv.amount_minor
             FROM price_version pv
             JOIN fulfillment_location fl ON fl.id=?
             JOIN market m ON m.id=fl.market_id
             LEFT JOIN market_commerce_policy mcp ON mcp.market_id=m.id
             WHERE pv.sku_id=s.id AND pv.market_id=fl.market_id
               AND pv.location_id=fl.id
               AND pv.currency=COALESCE(mcp.currency, m.currency)
               AND pv.price_type='STANDARD'
               AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
             ORDER BY pv.version DESC LIMIT 1
           ) AS unit_price_minor
         FROM sku s
         JOIN product p ON p.id=s.product_id
         LEFT JOIN sku_location_availability sla ON sla.sku_id=s.id AND sla.location_id=?
         WHERE s.id=?`,
      )
      .bind(cart.location_id, now, now, cart.location_id, command.skuId)
      .first<{
        id: string;
        sku_status: string;
        product_status: string;
        availability_status: string | null;
        unit_price_minor: number | null;
      }>();
    if (
      !sku ||
      sku.sku_status !== "active" ||
      sku.product_status !== "active" ||
      sku.availability_status !== "AVAILABLE"
    )
      return failure("ITEM_UNAVAILABLE", "This item is unavailable", command.requestId);
    if (sku.unit_price_minor === null)
      return failure("PRICE_UNAVAILABLE", "This item has no current price", command.requestId);
  }
  const validationMs = elapsedMs(validationStartedAt);

  const now = Date.now();
  const itemStatement =
    command.quantity > 0
      ? database
          .prepare(
            `INSERT INTO cart_item (cart_id, sku_id, quantity)
             SELECT ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM cart
               WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?
             ) AND EXISTS (
               SELECT 1 FROM idempotency_records
               WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'
             )
             ON CONFLICT(cart_id, sku_id) DO UPDATE SET quantity=excluded.quantity`,
          )
          .bind(
            cart.id,
            command.skuId,
            command.quantity,
            cart.id,
            command.customerId,
            command.expectedVersion,
            CART_SET_SCOPE,
            command.idempotencyKey,
            hash,
          )
      : database
          .prepare(
            `DELETE FROM cart_item
             WHERE cart_id=? AND sku_id=?
               AND EXISTS (
                 SELECT 1 FROM cart
                 WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?
               )
               AND EXISTS (
                 SELECT 1 FROM idempotency_records
                 WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'
               )`,
          )
          .bind(
            cart.id,
            command.skuId,
            cart.id,
            command.customerId,
            command.expectedVersion,
            CART_SET_SCOPE,
            command.idempotencyKey,
            hash,
          );

  const batchStartedAt = performance.now();
  try {
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, 'cart', 'PROCESSING', ?, ?)",
        )
        .bind(CART_SET_SCOPE, command.idempotencyKey, hash, now, now),
      cartMutationPaymentGuard(database, cart.id),
      itemStatement,
      database
        .prepare(
          `UPDATE cart SET version=version+1, updated_at=?
           WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?
             AND EXISTS (
               SELECT 1 FROM idempotency_records
               WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'
             )`,
        )
        .bind(
          now,
          cart.id,
          command.customerId,
          command.expectedVersion,
          CART_SET_SCOPE,
          command.idempotencyKey,
          hash,
        ),
      database.prepare("INSERT INTO commitment_abort (id) SELECT -5 WHERE changes()=0"),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(
          `${cart.id}:${command.expectedVersion + 1}`,
          now,
          CART_SET_SCOPE,
          command.idempotencyKey,
          hash,
        ),
    ]);
  } catch {
    const raced = await findIdempotencyRecord(database, CART_SET_SCOPE, command.idempotencyKey);
    if (raced?.requestHash !== undefined && raced.requestHash !== hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", command.requestId);
    if (raced?.status === "SUCCEEDED") return getCart(database, command);
    if (await cartHasUnsettledCheckout(database, cart.id))
      return paymentInProgressFailure(command.requestId);
    const latest = await activeCart(database, command.customerId);
    if (!latest || latest.id !== command.cartId)
      return failure("NOT_FOUND", "Active cart not found", command.requestId);
    if (latest.version !== command.expectedVersion)
      return failure(
        "CART_VERSION_CONFLICT",
        "The cart changed; reload it before updating",
        command.requestId,
      );
    return failure("INTERNAL_ERROR", "The cart update could not be applied", command.requestId);
  }
  const batchMs = elapsedMs(batchStartedAt);
  const readStartedAt = performance.now();
  const result = await getCart(database, command);
  log("info", "cart.setItem.completed", {
    requestId: command.requestId,
    totalMs: elapsedMs(startedAt),
    hashMs,
    idempotencyMs,
    cartLookupMs,
    paymentGuardMs,
    lineLookupMs,
    validationMs,
    batchMs,
    readMs: elapsedMs(readStartedAt),
  });
  return result;
}

export type AddCartItemsBatchCommand = {
  sourceOrderId: string;
  customerId: string;
  cartId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
  lines: readonly { skuId: string; quantity: number; productName: string }[];
};

export type AddCartItemsBatchValue = Pick<
  ReorderResultView,
  "outcome" | "cartId" | "newCartVersion" | "addedLines" | "skippedLines"
>;

export type AddCartItemsBatchResult =
  | { ok: true; value: AddCartItemsBatchValue; requestId: string }
  | ReturnType<typeof failure>;

function replayBatchValue(reference: string | null): AddCartItemsBatchValue | null {
  if (!reference) return null;
  try {
    const parsed = JSON.parse(reference) as AddCartItemsBatchValue;
    return parsed && typeof parsed === "object" && typeof parsed.cartId === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Add multiple current, purchasable SKUs to one ordinary active Cart under a
 * single aggregate-version guard. Callers supply historical display names for
 * controlled skip feedback only; current SKU state and price remain Cart-owned.
 */
export async function addCartItemsBatch(
  database: D1Database,
  command: AddCartItemsBatchCommand,
): Promise<AddCartItemsBatchResult> {
  const normalized = [...command.lines]
    .map((line) => ({
      skuId: line.skuId,
      quantity: line.quantity,
      productName: line.productName,
    }))
    .sort((left, right) => left.skuId.localeCompare(right.skuId));
  const hash = await requestHash({
    sourceOrderId: command.sourceOrderId,
    cartId: command.cartId,
    expectedVersion: command.expectedVersion,
    lines: normalized,
  });
  const existing = await findIdempotencyRecord(database, CART_BATCH_SCOPE, command.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for another reorder",
        command.requestId,
      );
    if (existing.status === "SUCCEEDED") {
      const value = replayBatchValue(existing.resultReference);
      return value
        ? { ok: true, value, requestId: command.requestId }
        : failure("INTERNAL_ERROR", "The reorder result could not be recovered", command.requestId);
    }
    return failure("CONFLICT", "The reorder is already being processed", command.requestId);
  }

  const cart = await database
    .prepare(
      "SELECT id, location_id, version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'",
    )
    .bind(command.cartId, command.customerId)
    .first<CartRow>();
  if (!cart) return failure("NOT_FOUND", "Active cart not found", command.requestId);
  if (await cartHasUnsettledCheckout(database, cart.id))
    return paymentInProgressFailure(command.requestId);
  if (cart.version !== command.expectedVersion)
    return failure(
      "CART_VERSION_CONFLICT",
      "The cart changed; reload it before reordering",
      command.requestId,
    );

  const currency = await database
    .prepare(
      "SELECT COALESCE(mcp.currency,m.currency) AS currency FROM fulfillment_location fl JOIN market m ON m.id=fl.market_id LEFT JOIN market_commerce_policy mcp ON mcp.market_id=m.id WHERE fl.id=?",
    )
    .bind(cart.location_id)
    .first<{ currency: string }>();
  if (!currency)
    return failure(
      "CONFIGURATION_ERROR",
      "Cart market currency is not configured",
      command.requestId,
    );

  const requested = new Map<string, { quantity: number; productName: string }>();
  for (const line of normalized) {
    const prior = requested.get(line.skuId);
    requested.set(line.skuId, {
      quantity: (prior?.quantity ?? 0) + line.quantity,
      productName: prior?.productName ?? line.productName,
    });
  }
  const skuIds = [...requested.keys()];
  const now = Date.now();
  const candidates =
    skuIds.length === 0
      ? {
          results: [] as Array<{
            skuId: string;
            name: string;
            skuStatus: string;
            productStatus: string;
            availabilityStatus: string | null;
            unitPriceMinor: number | null;
            existingQuantity: number;
          }>,
        }
      : await database
          .prepare(
            `SELECT s.id AS skuId, p.name || ' · ' || s.name AS name, s.status AS skuStatus, p.status AS productStatus,
                    sla.availability_status AS availabilityStatus,
                    COALESCE(ci.quantity,0) AS existingQuantity,
                    (
                      SELECT pv.amount_minor FROM price_version pv
                      JOIN fulfillment_location fl ON fl.id=?
                      WHERE pv.sku_id=s.id AND pv.market_id=fl.market_id
                        AND pv.location_id=fl.id
                        AND pv.currency=? AND pv.price_type='STANDARD'
                        AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
                      ORDER BY pv.version DESC LIMIT 1
                    ) AS unitPriceMinor
             FROM sku s JOIN product p ON p.id=s.product_id
             LEFT JOIN sku_location_availability sla
               ON sla.sku_id=s.id AND sla.location_id=?
             LEFT JOIN cart_item ci ON ci.cart_id=? AND ci.sku_id=s.id
             WHERE s.id IN (${skuIds.map(() => "?").join(",")})`,
          )
          .bind(cart.location_id, currency.currency, now, now, cart.location_id, cart.id, ...skuIds)
          .all<{
            skuId: string;
            name: string;
            skuStatus: string;
            productStatus: string;
            availabilityStatus: string | null;
            unitPriceMinor: number | null;
            existingQuantity: number;
          }>();
  const candidateById = new Map(
    candidates.results.map((candidate) => [candidate.skuId, candidate]),
  );
  const addedLines: AddCartItemsBatchValue["addedLines"][number][] = [];
  const skippedLines: AddCartItemsBatchValue["skippedLines"][number][] = [];
  for (const [skuId, line] of requested) {
    const candidate = candidateById.get(skuId);
    let reason: ReorderSkippedReason | null = null;
    if (!Number.isInteger(line.quantity) || line.quantity <= 0)
      reason = "INVALID_HISTORICAL_QUANTITY";
    else if (!candidate || candidate.skuStatus !== "active") reason = "SKU_INACTIVE";
    else if (candidate.productStatus !== "active") reason = "PRODUCT_INACTIVE";
    else if (candidate.availabilityStatus !== "AVAILABLE") reason = "LOCATION_UNAVAILABLE";
    else if (candidate.unitPriceMinor === null) reason = "PRICE_UNAVAILABLE";
    if (reason) {
      skippedLines.push({
        skuId,
        productName: line.productName,
        quantity: line.quantity,
        reason,
      });
      continue;
    }
    addedLines.push({
      skuId,
      name: candidate!.name,
      quantityAdded: line.quantity,
      newQuantity: candidate!.existingQuantity + line.quantity,
      currentUnitPriceMinor: candidate!.unitPriceMinor!,
      currency: currency.currency,
    });
  }
  const value: AddCartItemsBatchValue = {
    outcome:
      addedLines.length === 0 ? "NO_ITEMS_ADDED" : skippedLines.length > 0 ? "PARTIAL" : "COMPLETE",
    cartId: cart.id,
    newCartVersion: cart.version + (addedLines.length > 0 ? 1 : 0),
    addedLines,
    skippedLines,
  };
  const resultReference = JSON.stringify(value);

  if (addedLines.length === 0) {
    const inserted = await database
      .prepare(
        "INSERT OR IGNORE INTO idempotency_records (scope,idempotency_key,request_hash,result_type,status,result_reference,created_at,updated_at) VALUES (?,?,?,'cart_batch','SUCCEEDED',?,?,?)",
      )
      .bind(CART_BATCH_SCOPE, command.idempotencyKey, hash, resultReference, now, now)
      .run();
    if ((inserted.meta?.changes ?? 0) === 1)
      return { ok: true, value, requestId: command.requestId };
    const raced = await findIdempotencyRecord(database, CART_BATCH_SCOPE, command.idempotencyKey);
    if (raced?.requestHash !== hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", command.requestId);
    const replay = replayBatchValue(raced?.resultReference ?? null);
    return replay
      ? { ok: true, value: replay, requestId: command.requestId }
      : failure("CONFLICT", "The reorder is already being processed", command.requestId);
  }

  try {
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO idempotency_records (scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES (?,?,?,'cart_batch','PROCESSING',?,?)",
        )
        .bind(CART_BATCH_SCOPE, command.idempotencyKey, hash, now, now),
      cartMutationPaymentGuard(database, cart.id),
      ...addedLines.map((line) =>
        database
          .prepare(
            `INSERT INTO cart_item (cart_id,sku_id,quantity)
             SELECT ?,?,? WHERE EXISTS (
               SELECT 1 FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?
             ) AND EXISTS (
               SELECT 1 FROM idempotency_records
               WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'
             )
             ON CONFLICT(cart_id,sku_id) DO UPDATE SET quantity=excluded.quantity`,
          )
          .bind(
            cart.id,
            line.skuId,
            line.newQuantity,
            cart.id,
            command.customerId,
            command.expectedVersion,
            CART_BATCH_SCOPE,
            command.idempotencyKey,
            hash,
          ),
      ),
      database
        .prepare(
          `UPDATE cart SET version=version+1,updated_at=?
           WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?
             AND EXISTS (SELECT 1 FROM idempotency_records
               WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING')`,
        )
        .bind(
          now,
          cart.id,
          command.customerId,
          command.expectedVersion,
          CART_BATCH_SCOPE,
          command.idempotencyKey,
          hash,
        ),
      database.prepare("INSERT INTO commitment_abort (id) SELECT -6 WHERE changes()=0"),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(resultReference, now, CART_BATCH_SCOPE, command.idempotencyKey, hash),
    ]);
  } catch {
    const raced = await findIdempotencyRecord(database, CART_BATCH_SCOPE, command.idempotencyKey);
    if (raced?.requestHash !== undefined && raced.requestHash !== hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", command.requestId);
    if (raced?.status === "SUCCEEDED") {
      const replay = replayBatchValue(raced.resultReference);
      if (replay) return { ok: true, value: replay, requestId: command.requestId };
    }
    if (await cartHasUnsettledCheckout(database, cart.id))
      return paymentInProgressFailure(command.requestId);
    const latest = await activeCart(database, command.customerId);
    if (!latest || latest.id !== cart.id)
      return failure("NOT_FOUND", "Active cart not found", command.requestId);
    if (latest.version !== command.expectedVersion)
      return failure(
        "CART_VERSION_CONFLICT",
        "The cart changed; reload it before reordering",
        command.requestId,
      );
    return failure("INTERNAL_ERROR", "The reorder could not be applied", command.requestId);
  }
  return { ok: true, value, requestId: command.requestId };
}
