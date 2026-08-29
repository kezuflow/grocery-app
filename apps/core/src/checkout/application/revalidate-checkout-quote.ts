import type { CheckoutQuoteRow } from "../infrastructure/d1-checkout-repository";
import type { RouteDistancePort } from "../../geography/ports/route-distance";
import { quoteDeliveryFee } from "../../geography/application/quote-delivery-fee";
import { evaluateSubscriptionEntitlement } from "../../membership/application/evaluate-subscription-entitlement";
import { resolveCheckoutDecision } from "./resolve-checkout-decision";

type RevalidationFailure = {
  ok: false;
  code: string;
  message: string;
};

type Snapshot = {
  cycleId?: string;
  zoneId?: string;
  locationId?: string;
};

type LiveCartItem = {
  sku_id: string;
  quantity: number;
  product_id: string;
  inventory_pool_id: string;
  consumption_base_quantity: number;
  sourcing_mode: "STOCKED" | "PLANNED" | "ON_DEMAND" | "MIXED";
};

function rejected(code: string, message: string): RevalidationFailure {
  return { ok: false, code, message };
}

/**
 * Recalculate payment-readiness against live authoritative state without
 * creating, superseding, or reserving another quote. The accepted quote stays
 * the payment subject; this function only proves that its immutable evidence
 * still agrees with current entitlement, cart, routing, price, fee, and
 * mode-specific capacity/hold state.
 */
export async function revalidateCheckoutQuote(
  database: D1Database,
  quote: CheckoutQuoteRow,
  routeDistance: RouteDistancePort,
  now = Date.now(),
): Promise<{ ok: true } | RevalidationFailure> {
  const entitlement = await evaluateSubscriptionEntitlement(database, {
    customerId: quote.customerId,
    at: now,
  });
  if (!entitlement.eligible)
    return rejected("MEMBERSHIP_REQUIRED", "Membership is no longer eligible for checkout");

  const [cart, address, liveItems] = await Promise.all([
    database
      .prepare("SELECT id FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'")
      .bind(quote.cartId, quote.customerId)
      .first<{ id: string }>(),
    database
      .prepare(
        "SELECT latitude, longitude, delivery_zone_code FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
      )
      .bind(quote.addressId, quote.customerId)
      .first<{ latitude: number; longitude: number; delivery_zone_code: string | null }>(),
    database
      .prepare(
        `SELECT ci.sku_id, ci.quantity, p.id AS product_id, p.inventory_pool_id,
                s.consumption_base_quantity, ip.canonical_sourcing_mode AS sourcing_mode
         FROM cart_item ci
         JOIN sku s ON s.id=ci.sku_id
         JOIN product p ON p.id=s.product_id
         JOIN inventory_pool ip ON ip.id=p.inventory_pool_id
         WHERE ci.cart_id=? ORDER BY ci.sku_id`,
      )
      .bind(quote.cartId)
      .all<LiveCartItem>(),
  ]);
  if (!cart || !address) return rejected("CONFLICT", "Checkout identity is no longer valid");
  if (liveItems.results.length !== quote.lines.length)
    return rejected("PRICE_CHANGED", "Cart contents changed; accept a new quote");

  const quotedLines = new Map(quote.lines.map((line) => [line.skuId, line]));
  for (const item of liveItems.results) {
    const line = quotedLines.get(item.sku_id);
    if (
      !line ||
      line.quantity !== item.quantity ||
      line.productId !== item.product_id ||
      line.baseQuantity !== item.quantity * item.consumption_base_quantity ||
      line.sourcingMode !== item.sourcing_mode
    )
      return rejected("PRICE_CHANGED", "Cart contents changed; accept a new quote");
  }

  const snapshot = (quote.cycleSnapshot ?? {}) as Snapshot;
  if (!snapshot.locationId || !snapshot.zoneId)
    return rejected("CONFIGURATION_ERROR", "Quote routing evidence is incomplete");

  let marketId: string;
  let origin: { latitude: number; longitude: number };
  if (quote.fulfillmentMode === "INSTANT") {
    const routing = await database
      .prepare(
        `SELECT fl.market_id, fl.latitude, fl.longitude
         FROM delivery_zone dz
         JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1
         JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.status='active'
         JOIN fulfillment_location_mode m ON m.location_id=fl.id
         WHERE dz.code=? AND dz.id=? AND fl.id=? AND dz.status='active'
           AND m.active_mode='INSTANT' AND m.promise_minutes IS NOT NULL
           AND m.max_concurrent_instant_orders IS NOT NULL`,
      )
      .bind(address.delivery_zone_code ?? "", snapshot.zoneId, snapshot.locationId)
      .first<{ market_id: string; latitude: number; longitude: number }>();
    if (!routing)
      return rejected("INSTANT_MODE_UNAVAILABLE", "Instant checkout is no longer available");
    marketId = routing.market_id;
    origin = { latitude: routing.latitude, longitude: routing.longitude };

    for (const item of liveItems.results) {
      const held = await database
        .prepare(
          "SELECT COALESCE(SUM(quantity),0) AS quantity FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND inventory_pool_id=? AND location_id=? AND status='HELD'",
        )
        .bind(quote.id, item.inventory_pool_id, snapshot.locationId)
        .first<{ quantity: number }>();
      if ((held?.quantity ?? 0) < item.quantity * item.consumption_base_quantity)
        return rejected("INSUFFICIENT_STOCK", "The checkout inventory hold is no longer valid");
    }
  } else {
    const cycle = await database
      .prepare(
        `SELECT dc.market_id, fl.latitude, fl.longitude
         FROM delivery_cycle dc
         JOIN cycle_zone_capacity czc ON czc.cycle_id=dc.id
         JOIN fulfillment_location fl ON fl.id=czc.location_id AND fl.status='active'
         WHERE dc.id=? AND dc.status='OPEN' AND dc.cutoff_at>?
           AND czc.zone_id=? AND czc.location_id=? AND czc.allocated<czc.capacity`,
      )
      .bind(quote.deliveryCycleId, now, snapshot.zoneId, snapshot.locationId)
      .first<{ market_id: string; latitude: number; longitude: number }>();
    if (!cycle)
      return rejected("CAPACITY_UNAVAILABLE", "Scheduled capacity is no longer available");
    const routed = await database
      .prepare(
        `SELECT 1 AS eligible FROM delivery_zone dz
         JOIN service_area sa ON sa.id=dz.service_area_id
         JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1
         WHERE dz.code=? AND dz.id=? AND dz.status='active' AND sa.market_id=? AND ls.location_id=?`,
      )
      .bind(address.delivery_zone_code ?? "", snapshot.zoneId, cycle.market_id, snapshot.locationId)
      .first<{ eligible: number }>();
    if (!routed) return rejected("ADDRESS_UNSERVICEABLE", "Address is no longer serviceable");
    marketId = cycle.market_id;
    origin = { latitude: cycle.latitude, longitude: cycle.longitude };
  }

  let subtotalMinor = 0;
  for (const item of liveItems.results) {
    const line = quotedLines.get(item.sku_id)!;
    const [price, availability] = await Promise.all([
      database
        .prepare(
          `SELECT amount_minor FROM price_version
           WHERE sku_id=? AND market_id=? AND currency=? AND price_type='STANDARD'
             AND (location_id IS NULL OR location_id=?)
             AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)
           ORDER BY (location_id IS NOT NULL) DESC, version DESC LIMIT 1`,
        )
        .bind(item.sku_id, marketId, quote.currency, snapshot.locationId, now, now)
        .first<{ amount_minor: number }>(),
      database
        .prepare(
          "SELECT availability_status FROM location_product_availability WHERE location_id=? AND product_id=?",
        )
        .bind(snapshot.locationId, item.product_id)
        .first<{ availability_status: string }>(),
    ]);
    if (
      !price ||
      price.amount_minor !== line.unitPriceMinor ||
      (availability && availability.availability_status !== "AVAILABLE")
    )
      return rejected("PRICE_CHANGED", "Price or availability changed; accept a new quote");
    subtotalMinor += price.amount_minor * item.quantity;
  }

  let deliveryFee;
  try {
    deliveryFee = await quoteDeliveryFee(database, routeDistance, {
      marketId,
      locationId: snapshot.locationId,
      origin,
      destination: { latitude: address.latitude, longitude: address.longitude },
      now,
    });
  } catch {
    return rejected("CONFIGURATION_ERROR", "Delivery fee configuration is unavailable");
  }
  const currentFinancial = {
    ...quote.financial,
    merchandiseSubtotalMinor: subtotalMinor,
    deliverySubtotalMinor: deliveryFee.feeMinor,
    totalMinor:
      subtotalMinor -
      quote.financial.itemDiscountMinor -
      quote.financial.orderDiscountMinor +
      deliveryFee.feeMinor -
      quote.financial.deliveryDiscountMinor +
      quote.financial.serviceFeeMinor +
      quote.financial.taxMinor,
    currency: deliveryFee.snapshot.currency,
  };
  const decision = await resolveCheckoutDecision(database, {
    marketId,
    financial: currentFinancial,
    evidence: {
      fulfillmentMode: quote.fulfillmentMode,
      zoneId: snapshot.zoneId,
      locationId: snapshot.locationId,
      lines: quote.lines,
      deliveryFeeSnapshot: deliveryFee.snapshot,
    },
  });
  if (!decision.eligible)
    return rejected(
      decision.failures[0] ?? "CONFIGURATION_ERROR",
      "Checkout is no longer eligible",
    );
  if (JSON.stringify(currentFinancial) !== JSON.stringify(quote.financial))
    return rejected("PRICE_CHANGED", "Order total changed; accept a new quote");
  return { ok: true };
}
