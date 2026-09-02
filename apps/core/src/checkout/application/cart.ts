import type {
  AuthenticatedRequest,
  CartView,
  ReorderResultView,
  ReorderSkippedReason,
  SetCartItemRequest,
} from "@freshmarkets/contracts";
import type { AppErrorCode } from "@freshmarkets/contracts";
import { activeFulfillmentLocationId, activeMarketCode } from "../../geography/market-defaults";
import { findIdempotencyRecord, requestHash } from "../../idempotency";

const CART_SET_SCOPE = "cart.setItem";
const CART_BATCH_SCOPE = "cart.addBatch";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
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

/** Load or atomically provision the customer's single active cart. */
export async function getCart(
  database: D1Database,
  input: AuthenticatedRequest & { customerId: string },
): Promise<CartResult> {
  let cart = await activeCart(database, input.customerId);
  if (!cart) {
    const locationId = await activeFulfillmentLocationId(
      database,
      await activeMarketCode(database),
    );
    if (!locationId)
      return failure(
        "CONFIGURATION_ERROR",
        "No active fulfillment location is configured",
        input.requestId,
      );
    const now = Date.now();
    await database
      .prepare(
        `INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?)
         ON CONFLICT(customer_id) WHERE status='ACTIVE' DO NOTHING`,
      )
      .bind(crypto.randomUUID(), input.customerId, locationId, now, now)
      .run();
    cart = await activeCart(database, input.customerId);
    if (!cart)
      return failure("INTERNAL_ERROR", "The active cart could not be provisioned", input.requestId);
  }

  const currency = await database
    .prepare(
      "SELECT COALESCE(mcp.currency, m.currency) AS currency FROM fulfillment_location fl JOIN market m ON m.id=fl.market_id LEFT JOIN market_commerce_policy mcp ON mcp.market_id=m.id WHERE fl.id=?",
    )
    .bind(cart.location_id)
    .first<{ currency: string }>();
  if (!currency)
    return failure(
      "CONFIGURATION_ERROR",
      "Cart market currency is not configured",
      input.requestId,
    );

  const now = Date.now();
  const rows = await database
    .prepare(
      `SELECT ci.sku_id, ci.quantity, s.name,
         s.status AS sku_status, p.status AS product_status, sla.availability_status,
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
      sku_status: string;
      product_status: string;
      availability_status: string | null;
      unit_price_minor: number | null;
    }>();

  const items: CartView["items"][number][] = rows.results.map((row) => {
    const availability =
      row.sku_status !== "active" ||
      row.product_status !== "active" ||
      row.availability_status !== "AVAILABLE"
        ? "UNAVAILABLE"
        : row.unit_price_minor === null
          ? "PRICE_UNAVAILABLE"
          : "AVAILABLE";
    const unitPriceMinor = availability === "AVAILABLE" ? row.unit_price_minor : null;
    return {
      skuId: row.sku_id,
      quantity: row.quantity,
      name: row.name,
      availability,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor === null ? null : row.quantity * unitPriceMinor,
    };
  });
  const blockingReasons = [
    ...(items.some((item) => item.availability === "UNAVAILABLE")
      ? (["ITEM_UNAVAILABLE"] as const)
      : []),
    ...(items.some((item) => item.availability === "PRICE_UNAVAILABLE")
      ? (["PRICE_UNAVAILABLE"] as const)
      : []),
  ];
  return {
    ok: true,
    value: {
      id: cart.id,
      version: cart.version,
      items,
      totalMinor: items.reduce((sum, item) => sum + (item.lineTotalMinor ?? 0), 0),
      currency: currency.currency,
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
  const hash = await requestHash({
    cartId: command.cartId,
    skuId: command.skuId,
    quantity: command.quantity,
    expectedVersion: command.expectedVersion,
  });
  const existing = await findIdempotencyRecord(database, CART_SET_SCOPE, command.idempotencyKey);
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

  const cart = await database
    .prepare(
      "SELECT id, location_id, version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'",
    )
    .bind(command.cartId, command.customerId)
    .first<CartRow>();
  if (!cart) return failure("NOT_FOUND", "Active cart not found", command.requestId);
  if (cart.version !== command.expectedVersion)
    return failure(
      "CART_VERSION_CONFLICT",
      "The cart changed; reload it before updating",
      command.requestId,
    );

  const existingLine = await database
    .prepare("SELECT quantity FROM cart_item WHERE cart_id=? AND sku_id=?")
    .bind(cart.id, command.skuId)
    .first<{ quantity: number }>();
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

  try {
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, 'cart', 'PROCESSING', ?, ?)",
        )
        .bind(CART_SET_SCOPE, command.idempotencyKey, hash, now, now),
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
  return getCart(database, command);
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
            `SELECT s.id AS skuId, s.name, s.status AS skuStatus, p.status AS productStatus,
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
