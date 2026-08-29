import {
  createCheckoutRepository,
  type CheckoutQuoteRow,
} from "../infrastructure/d1-checkout-repository";
import type { QuoteLine } from "../domain/quote";
import { QUOTE_TTL_MS } from "../domain/quote";
import {
  type CheckoutQuoteDependencies,
  type CreateCheckoutQuoteCommand,
  type CheckoutQuoteView,
} from "./create-checkout-quote";
import { quoteDeliveryFee } from "../../geography/application/quote-delivery-fee";
import { deliveryFeeFailure } from "./delivery-fee-failure";

export type QuoteItem = {
  sku_id: string;
  quantity: number;
  variant_name: string;
  unit: string;
  consumption_base_quantity: number;
  product_id: string;
  product_name: string;
  inventory_pool_id: string;
  sourcing_mode: "STOCKED" | "PLANNED" | "ON_DEMAND" | "MIXED";
};

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * The Instant quote path: the routed location's active INSTANT configuration
 * supplies promise and capacity; only STOCKED sourcing participates; expiring
 * holds reserve usable stock until commitment or scheduler-driven expiry.
 */
export async function createInstantQuote(
  database: D1Database,
  repository: ReturnType<typeof createCheckoutRepository>,
  command: CreateCheckoutQuoteCommand,
  items: readonly QuoteItem[],
  address: Record<string, unknown> & {
    delivery_zone_code: string | null;
    latitude: number;
    longitude: number;
  },
  dependencies: CheckoutQuoteDependencies,
): Promise<{ ok: true; value: CheckoutQuoteView; requestId: string } | ReturnType<typeof failure>> {
  const unstocked = items.find((item) => item.sourcing_mode !== "STOCKED");
  if (unstocked)
    return failure(
      "UNAVAILABLE_ITEM",
      `${unstocked.product_name} is not stocked for instant delivery`,
      command.requestId,
    );

  // Route to an eligible location whose active mode is a complete INSTANT
  // configuration (promise + capacity); incomplete configs fail closed.
  const routing = await database
    .prepare(
      `SELECT dz.id AS zone_id, sa.market_id, ls.location_id, fl.name AS location_name,
              m.promise_minutes, m.max_concurrent_instant_orders,
              fl.latitude, fl.longitude
       FROM delivery_zone dz JOIN service_area sa ON sa.id=dz.service_area_id
       JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1
       JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.status='active'
       JOIN fulfillment_location_mode m ON m.location_id=fl.id
       WHERE dz.code=? AND dz.status='active' AND m.active_mode='INSTANT'
         AND m.promise_minutes IS NOT NULL AND m.max_concurrent_instant_orders IS NOT NULL
       ORDER BY ls.priority LIMIT 1`,
    )
    .bind(address.delivery_zone_code ?? "")
    .first<{
      zone_id: string;
      market_id: string;
      location_id: string;
      location_name: string;
      promise_minutes: number;
      max_concurrent_instant_orders: number;
      latitude: number;
      longitude: number;
    }>();
  if (!routing)
    return failure(
      "INSTANT_MODE_UNAVAILABLE",
      "Instant delivery is not available at this address",
      command.requestId,
    );

  const now = Date.now();

  let deliveryFee;
  try {
    deliveryFee = await quoteDeliveryFee(database, dependencies.routeDistance, {
      marketId: routing.market_id,
      locationId: routing.location_id,
      origin: { latitude: routing.latitude, longitude: routing.longitude },
      destination: { latitude: address.latitude, longitude: address.longitude },
      now,
    });
  } catch (error) {
    return deliveryFeeFailure(error, command.requestId);
  }

  // Usable stocked availability per pool: on_hand minus reserved and held.
  const demandByPool = new Map<string, number>();
  for (const item of items) {
    const baseQuantity = item.quantity * item.consumption_base_quantity;
    demandByPool.set(
      item.inventory_pool_id,
      (demandByPool.get(item.inventory_pool_id) ?? 0) + baseQuantity,
    );
  }
  for (const [poolId, baseQuantity] of demandByPool) {
    const balance = await database
      .prepare(
        `SELECT (b.on_hand - b.reserved - COALESCE((SELECT SUM(h.quantity) FROM checkout_inventory_holds h WHERE h.inventory_pool_id=b.inventory_pool_id AND h.location_id=b.location_id AND h.status='HELD' AND h.checkout_attempt_id NOT IN (SELECT id FROM checkout_quote WHERE cart_id=?)),0)) AS usable
         FROM inventory_balance b WHERE b.location_id=? AND b.inventory_pool_id=?`,
      )
      .bind(command.cartId, routing.location_id, poolId)
      .first<{ usable: number | null }>();
    if (!balance || balance.usable === null || balance.usable < baseQuantity)
      return failure(
        "INSUFFICIENT_STOCK",
        "Not enough stock for instant delivery",
        command.requestId,
      );
  }

  // Location-aware pricing with fallback to market price. Missing price fails.
  const lines: QuoteLine[] = [];
  let subtotalMinor = 0;
  for (const item of items) {
    const price = await database
      .prepare(
        `SELECT amount_minor FROM price_version pv
         WHERE pv.sku_id=? AND pv.market_id=? AND pv.currency=(SELECT currency FROM market WHERE id=?)
           AND pv.price_type='STANDARD' AND (pv.location_id IS NULL OR pv.location_id=?)
           AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
         ORDER BY (pv.location_id IS NOT NULL) DESC, pv.version DESC LIMIT 1`,
      )
      .bind(item.sku_id, routing.market_id, routing.market_id, routing.location_id, now, now)
      .first<{ amount_minor: number }>();
    if (!price)
      return failure(
        "PRICE_CHANGED",
        `No authoritative price for ${item.sku_id}`,
        command.requestId,
      );
    const availability = await database
      .prepare(
        "SELECT availability_status FROM location_product_availability WHERE location_id=? AND product_id=?",
      )
      .bind(routing.location_id, item.product_id)
      .first<{ availability_status: string }>();
    if (availability && availability.availability_status !== "AVAILABLE")
      return failure(
        "UNAVAILABLE_ITEM",
        `${item.product_name} is unavailable at this location`,
        command.requestId,
      );
    const lineTotal = price.amount_minor * item.quantity;
    subtotalMinor += lineTotal;
    lines.push({
      skuId: item.sku_id,
      productId: item.product_id,
      productName: item.product_name,
      variantName: item.variant_name,
      unit: item.unit,
      quantity: item.quantity,
      baseQuantity: item.quantity * item.consumption_base_quantity,
      unitPriceMinor: price.amount_minor,
      lineTotalMinor: lineTotal,
      sourcingMode: item.sourcing_mode,
    });
  }

  const quoteId = crypto.randomUUID();
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  try {
    await database.batch([
      database
        .prepare(
          "UPDATE checkout_inventory_holds SET status='EXPIRED', updated_at=? WHERE status='HELD' AND checkout_attempt_id IN (SELECT id FROM checkout_quote WHERE cart_id=?)",
        )
        .bind(now, command.cartId),
      repository.insertQuote(
        {
          id: quoteId,
          attemptId: quoteId,
          customerId: command.customerId,
          cartId: command.cartId,
          addressId: command.addressId,
          deliveryCycleId: null,
          fulfillmentMode: "INSTANT",
          currency: "PHP",
          financial: {
            merchandiseSubtotalMinor: subtotalMinor,
            itemDiscountMinor: 0,
            orderDiscountMinor: 0,
            deliverySubtotalMinor: deliveryFee.feeMinor,
            deliveryDiscountMinor: 0,
            serviceFeeMinor: 0,
            taxMinor: 0,
            totalMinor: subtotalMinor + deliveryFee.feeMinor,
            currency: "PHP",
          },
          subtotalMinor,
          discountMinor: 0,
          deliveryFeeMinor: deliveryFee.feeMinor,
          totalMinor: subtotalMinor + deliveryFee.feeMinor,
          lines,
          addressSnapshot: address,
          cycleSnapshot: {
            zoneId: routing.zone_id,
            locationId: routing.location_id,
            locationName: routing.location_name,
          },
          fulfillmentSnapshot: {
            fulfillmentMode: "INSTANT",
            promisedAt: new Date(now + routing.promise_minutes * 60_000).toISOString(),
            sourcingModes: [...new Set(lines.map((line) => line.sourcingMode))],
            poolIds: [...new Set(items.map((item) => item.inventory_pool_id))],
          },
          deliveryFeeSnapshot: deliveryFee.snapshot,
          status: "ACTIVE",
          version: 1,
          expiresAt,
          idempotencyKey: command.idempotencyKey,
        },
        Date.now(),
      ),
      database
        .prepare(
          "INSERT INTO checkout_attempts (id, customer_id, cart_id, address_id, cycle_id, fulfillment_mode, zone_id, location_id, quote_version, status, idempotency_key, expires_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'INSTANT', ?, ?, 1, 'PROCESSING', ?, ?, 1, ?, ?)",
        )
        .bind(
          quoteId,
          command.customerId,
          command.cartId,
          command.addressId,
          routing.zone_id,
          routing.location_id,
          `${command.idempotencyKey}:instant`,
          expiresAt,
          now,
          now,
        ),
      ...[...demandByPool.entries()].map(([poolId, baseQuantity]) =>
        database
          .prepare(
            "INSERT INTO checkout_inventory_holds (id, checkout_attempt_id, inventory_pool_id, location_id, quantity, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'HELD', ?, ?)",
          )
          .bind(crypto.randomUUID(), quoteId, poolId, routing.location_id, baseQuantity, now, now),
      ),
      repository.supersedeQuotesForCart(command.cartId, quoteId, Date.now()),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      const replayed = await repository.findQuoteByIdempotencyKey(command.idempotencyKey);
      if (replayed) return { ok: true, value: viewFrom(replayed), requestId: command.requestId };
    }
    throw error;
  }
  const stored = await repository.findQuoteById(quoteId);
  return stored
    ? { ok: true, value: viewFrom(stored), requestId: command.requestId }
    : failure("INTERNAL_ERROR", "Quote persistence failed", command.requestId);
}

function viewFrom(row: CheckoutQuoteRow): CheckoutQuoteView {
  return {
    quoteId: row.id,
    attemptVersion: row.version,
    expiresAt: new Date(row.expiresAt).toISOString(),
    currency: row.currency,
    merchandiseSubtotalMinor: row.financial.merchandiseSubtotalMinor,
    itemDiscountMinor: row.financial.itemDiscountMinor,
    orderDiscountMinor: row.financial.orderDiscountMinor,
    deliveryDiscountMinor: row.financial.deliveryDiscountMinor,
    serviceFeeMinor: row.financial.serviceFeeMinor,
    taxMinor: row.financial.taxMinor,
    subtotalMinor: row.subtotalMinor,
    discountMinor: row.discountMinor,
    deliveryFeeMinor: row.deliveryFeeMinor,
    totalMinor: row.totalMinor,
    lines: row.lines,
  };
}
