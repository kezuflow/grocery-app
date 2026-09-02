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
import { resolveCheckoutDecision } from "./resolve-checkout-decision";
import type { AppErrorCode } from "@freshmarkets/contracts";
import {
  evaluateCheckoutPromotions,
  promotionClaimStatements,
} from "../../promotions/application/evaluate-checkout-promotions";
import { resolveServiceFee } from "./resolve-service-fee";
import { closestLocation } from "../../geography/geometry";

export type QuoteItem = {
  sku_id: string;
  quantity: number;
  variant_name: string;
  unit: string;
  consumption_base_quantity: number;
  product_id: string;
  product_name: string;
  category_id: string;
  inventory_pool_id: string;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * The Instant quote path derives stock behavior from the global mode. The
 * closest operational location supplies readiness; expiring holds reserve
 * usable stock until commitment or scheduler-driven expiry.
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
  const routingRows = await database
    .prepare(
      `SELECT fl.id, dz.id AS zone_id, sa.market_id, ls.location_id,
              fl.name AS location_name, readiness.instant_promise_minutes AS promise_minutes,
              readiness.max_concurrent_instant_orders, fl.latitude, fl.longitude
       FROM delivery_zone dz JOIN service_area sa ON sa.id=dz.service_area_id
       JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1
       JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.status='active'
       JOIN global_fulfillment_mode mode ON mode.id='global' AND mode.active_mode='INSTANT'
       JOIN fulfillment_location_readiness readiness ON readiness.location_id=fl.id
       WHERE dz.code=? AND dz.status='active' AND readiness.dispatch_ready=1
         AND readiness.instant_promise_minutes IS NOT NULL
         AND readiness.max_concurrent_instant_orders IS NOT NULL
         AND EXISTS (SELECT 1 FROM location_capability c WHERE c.location_id=fl.id AND c.capability='PICKING' AND c.enabled=1)
         AND EXISTS (SELECT 1 FROM location_capability c WHERE c.location_id=fl.id AND c.capability='PACKING' AND c.enabled=1)
         AND EXISTS (SELECT 1 FROM location_capability c WHERE c.location_id=fl.id AND c.capability='DISPATCH' AND c.enabled=1)
       ORDER BY fl.id`,
    )
    .bind(address.delivery_zone_code ?? "")
    .all<{
      id: string;
      zone_id: string;
      market_id: string;
      location_id: string;
      location_name: string;
      promise_minutes: number;
      max_concurrent_instant_orders: number;
      latitude: number;
      longitude: number;
    }>();
  const routing = closestLocation(address, routingRows.results);
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

  // Exact-location pricing. Missing price fails; no Market fallback exists.
  const lines: QuoteLine[] = [];
  let subtotalMinor = 0;
  for (const item of items) {
    const price = await database
      .prepare(
        `SELECT amount_minor FROM price_version pv
         WHERE pv.sku_id=? AND pv.market_id=? AND pv.currency=(SELECT currency FROM market WHERE id=?)
           AND pv.price_type='STANDARD' AND pv.location_id=?
           AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
         ORDER BY pv.version DESC LIMIT 1`,
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
        "SELECT availability_status FROM sku_location_availability WHERE location_id=? AND sku_id=?",
      )
      .bind(routing.location_id, item.sku_id)
      .first<{ availability_status: string }>();
    if (!availability || availability.availability_status !== "AVAILABLE")
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
    });
  }

  const quoteId = crypto.randomUUID();
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  const requestedPromotionCodes = (command.promotionCodes ?? []).map((code) =>
    code.trim().toUpperCase(),
  );
  const promotion = await evaluateCheckoutPromotions(database, {
    customerId: command.customerId,
    marketId: routing.market_id,
    locationId: routing.location_id,
    fulfillmentMode: "INSTANT",
    merchandiseSubtotalMinor: subtotalMinor,
    deliverySubtotalMinor: deliveryFee.feeMinor,
    lineFacts: items.map((item) => ({
      skuId: item.sku_id,
      productId: item.product_id,
      categoryId: item.category_id,
      quantity: item.quantity,
      lineSubtotalMinor: lines.find((line) => line.skuId === item.sku_id)?.lineTotalMinor ?? 0,
    })),
    requestedCodes: requestedPromotionCodes,
    at: now,
  });
  const merchandiseDiscount =
    promotion.applications.find((application) => application.component === "MERCHANDISE")
      ?.amountMinor ?? 0;
  const deliveryDiscount =
    promotion.applications.find((application) => application.component === "DELIVERY")
      ?.amountMinor ?? 0;
  const promotionApplications = promotion.applications.map((application) => ({
    promotionId: application.promotionId,
    code: application.code,
    name: application.name,
    component: application.component,
    benefitType: application.benefitType,
    amountMinor: application.amountMinor,
    automatic: application.automatic,
  }));
  const preServiceFeeTotalMinor =
    subtotalMinor - merchandiseDiscount + deliveryFee.feeMinor - deliveryDiscount;
  const serviceFee = await resolveServiceFee(database, {
    currency: deliveryFee.snapshot.currency,
    baseMinor: preServiceFeeTotalMinor,
    at: now,
  });
  if (!serviceFee.ok)
    return failure(serviceFee.error.code, serviceFee.error.message, command.requestId);
  const financial = {
    merchandiseSubtotalMinor: subtotalMinor,
    itemDiscountMinor: 0,
    orderDiscountMinor: merchandiseDiscount,
    deliverySubtotalMinor: deliveryFee.feeMinor,
    deliveryDiscountMinor: deliveryDiscount,
    serviceFeeMinor: serviceFee.value.feeMinor,
    taxMinor: 0,
    totalMinor: preServiceFeeTotalMinor + serviceFee.value.feeMinor,
    currency: deliveryFee.snapshot.currency,
  };
  const decision = await resolveCheckoutDecision(database, {
    marketId: routing.market_id,
    financial,
    evidence: {
      lines,
      addressSnapshot: address,
      cycleSnapshot: {
        zoneId: routing.zone_id,
        locationId: routing.location_id,
        locationName: routing.location_name,
      },
      fulfillmentSnapshot: {
        fulfillmentOptionId: command.fulfillmentOptionId ?? null,
        fulfillmentMode: "INSTANT" as const,
        promisedAt: new Date(now + routing.promise_minutes * 60_000).toISOString(),
        poolIds: [...new Set(items.map((item) => item.inventory_pool_id))],
      },
      deliveryFeeSnapshot: deliveryFee.snapshot,
    },
  });
  if (!decision.eligible) {
    const code = decision.failures[0] ?? "CONFIGURATION_ERROR";
    return failure(
      code,
      code === "MINIMUM_ORDER_NOT_MET"
        ? "Basket does not meet the market minimum"
        : "Checkout market configuration is unavailable",
      command.requestId,
    );
  }
  const evidence = decision.evidence!;
  try {
    await database.batch([
      database
        .prepare(
          "UPDATE checkout_inventory_holds SET status='EXPIRED', updated_at=? WHERE status='HELD' AND checkout_attempt_id IN (SELECT id FROM checkout_quote WHERE cart_id=?)",
        )
        .bind(now, command.cartId),
      // The earlier read provides a fast customer-facing failure, but only
      // this transaction-local guard is authoritative. D1 serializes the
      // batch, so two carts cannot both insert holds against the same final
      // usable units after observing availability concurrently.
      ...[...demandByPool.entries()].map(([poolId, baseQuantity]) =>
        database
          .prepare(
            `INSERT INTO commitment_abort (id)
             SELECT -6 WHERE NOT EXISTS (
               SELECT 1 FROM inventory_balance b
               WHERE b.location_id=? AND b.inventory_pool_id=?
                 AND b.on_hand - b.reserved - COALESCE((
                   SELECT SUM(h.quantity) FROM checkout_inventory_holds h
                   WHERE h.inventory_pool_id=b.inventory_pool_id
                     AND h.location_id=b.location_id AND h.status='HELD'
                 ), 0) >= ?
             )`,
          )
          .bind(routing.location_id, poolId, baseQuantity),
      ),
      repository.insertQuote(
        {
          id: quoteId,
          attemptId: quoteId,
          customerId: command.customerId,
          cartId: command.cartId,
          addressId: command.addressId,
          deliveryCycleId: null,
          fulfillmentMode: "INSTANT",
          currency: decision.currency,
          financial,
          preServiceFeeTotalMinor,
          serviceFeeConfigurationId: serviceFee.value.configurationId,
          serviceFeeSnapshot: serviceFee.value,
          subtotalMinor,
          discountMinor: merchandiseDiscount,
          deliveryFeeMinor: deliveryFee.feeMinor,
          totalMinor: financial.totalMinor,
          lines: evidence.lines,
          addressSnapshot: evidence.addressSnapshot,
          cycleSnapshot: evidence.cycleSnapshot,
          fulfillmentSnapshot: evidence.fulfillmentSnapshot,
          deliveryFeeSnapshot: evidence.deliveryFeeSnapshot,
          status: "ACTIVE",
          version: 1,
          expiresAt,
          priceAcceptanceVersion: 1,
          requestedPromotionCodes,
          promotionFeedback: promotion.feedback,
          promotionApplications,
          idempotencyKey: command.idempotencyKey,
        },
        Date.now(),
      ),
      ...promotionClaimStatements(
        database,
        quoteId,
        command.customerId,
        promotion.applications,
        now,
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
    if (message.includes("CHECK constraint failed: id = 0") || message.includes("commitment_abort"))
      return failure(
        "INSUFFICIENT_STOCK",
        "Not enough stock for instant delivery",
        command.requestId,
      );
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
    priceAcceptanceVersion: row.priceAcceptanceVersion,
    expiresAt: new Date(row.expiresAt).toISOString(),
    currency: row.currency,
    merchandiseSubtotalMinor: row.financial.merchandiseSubtotalMinor,
    itemDiscountMinor: row.financial.itemDiscountMinor,
    orderDiscountMinor: row.financial.orderDiscountMinor,
    deliverySubtotalMinor: row.financial.deliverySubtotalMinor,
    deliveryDiscountMinor: row.financial.deliveryDiscountMinor,
    serviceFeeMinor: row.financial.serviceFeeMinor,
    preServiceFeeTotalMinor: row.preServiceFeeTotalMinor,
    taxMinor: row.financial.taxMinor,
    subtotalMinor: row.subtotalMinor,
    discountMinor: row.discountMinor,
    deliveryFeeMinor: row.deliveryFeeMinor,
    totalMinor: row.totalMinor,
    lines: row.lines,
    requestedPromotionCodes: row.requestedPromotionCodes,
    promotionFeedback: row.promotionFeedback,
    promotionApplications: row.promotionApplications,
  };
}
