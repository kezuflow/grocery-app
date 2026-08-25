import {
  createCheckoutRepository,
  type CheckoutQuoteRow,
} from "../infrastructure/d1-checkout-repository";
import type { QuoteLine } from "../domain/quote";
import { QUOTE_TTL_MS } from "../domain/quote";

export type CreateCheckoutQuoteCommand = {
  customerId: string;
  cartId: string;
  cartVersion: number;
  addressId: string;
  deliveryCycleId: string;
  idempotencyKey: string;
  requestId: string;
};

export type CheckoutQuoteView = {
  quoteId: string;
  attemptVersion: number;
  expiresAt: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  lines: ReadonlyArray<QuoteLine>;
};

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Create (or replay) the authoritative Core-side checkout quote. The quote is
 * evidence only: it reserves nothing and asserts no payment outcome. Pricing,
 * eligibility, serviceability, cycle/cutoff/capacity, and sourcing are all
 * resolved here in integer minor/base units.
 */
export async function createCheckoutQuote(
  database: D1Database,
  command: CreateCheckoutQuoteCommand,
): Promise<{ ok: true; value: CheckoutQuoteView; requestId: string } | ReturnType<typeof failure>> {
  const repository = createCheckoutRepository(database);

  // Idempotent replay first: same key returns the same immutable quote.
  const existing = await repository.findQuoteByIdempotencyKey(command.idempotencyKey);
  if (existing) {
    if (
      existing.customerId !== command.customerId ||
      existing.cartId !== command.cartId ||
      existing.addressId !== command.addressId ||
      existing.deliveryCycleId !== command.deliveryCycleId
    )
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    return { ok: true, value: viewFrom(existing), requestId: command.requestId };
  }

  // Membership entitlement at quote time.
  const membership = await database
    .prepare(
      "SELECT status FROM subscription WHERE customer_id=? AND status IN ('TRIALING','ACTIVE') ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(command.customerId)
    .first<{ status: string }>();
  if (!membership)
    return failure(
      "MEMBERSHIP_REQUIRED",
      "An active or trialing membership is required to check out",
      command.requestId,
    );

  // Cart identity and version.
  const cart = await database
    .prepare("SELECT id, customer_id, version FROM cart WHERE id=? AND status='active'")
    .bind(command.cartId)
    .first<{ id: string; customer_id: string; version: number }>();
  if (!cart || cart.customer_id !== command.customerId)
    return failure("NOT_FOUND", "Active cart not found", command.requestId);
  if (cart.version !== command.cartVersion)
    return failure(
      "CART_VERSION_CONFLICT",
      "Cart changed; refresh before quoting",
      command.requestId,
    );

  const cartItems = await database
    .prepare(
      `SELECT ci.sku_id, ci.quantity, s.name AS variant_name, s.sellable_unit_id AS unit, s.consumption_base_quantity,
              p.id AS product_id, p.name AS product_name, p.inventory_pool_id, ip.sourcing_mode
       FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN product p ON p.id=s.product_id
       JOIN inventory_pool ip ON ip.id=p.inventory_pool_id WHERE ci.cart_id=?`,
    )
    .bind(command.cartId)
    .all<{
      sku_id: string;
      quantity: number;
      variant_name: string;
      unit: string;
      consumption_base_quantity: number;
      product_id: string;
      product_name: string;
      inventory_pool_id: string;
      sourcing_mode: "STOCKED" | "PLANNED_PROCUREMENT" | "HYBRID";
    }>();
  if (cartItems.results.length === 0)
    return failure("VALIDATION_FAILED", "Cart is empty", command.requestId);

  // Cycle must be open and before cutoff.
  const cycle = await database
    .prepare(
      "SELECT id, market_id, cutoff_at, delivery_date, status FROM delivery_cycle WHERE id=? AND status='OPEN'",
    )
    .bind(command.deliveryCycleId)
    .first<{
      id: string;
      market_id: string;
      cutoff_at: number;
      delivery_date: number;
      status: string;
    }>();
  const now = Date.now();
  if (!cycle) return failure("CYCLE_CLOSED", "The delivery cycle is not open", command.requestId);
  if (cycle.cutoff_at <= now)
    return failure("CYCLE_CLOSED", "The cycle cutoff has passed", command.requestId);

  // Address serviceability and zone routing for this cycle's market.
  const address = await database
    .prepare("SELECT * FROM customer_address WHERE id=? AND customer_id=? AND status='active'")
    .bind(command.addressId, command.customerId)
    .first<Record<string, unknown> & { delivery_zone_code: string | null }>();
  if (!address) return failure("NOT_FOUND", "Customer address not found", command.requestId);

  const routing = await database
    .prepare(
      `SELECT dz.id AS zone_id, ls.location_id, fl.name AS location_name
       FROM delivery_zone dz JOIN service_area sa ON sa.id=dz.service_area_id
       JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1
       JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.status='active'
       WHERE dz.code=? AND dz.status='active' AND sa.market_id=?
       ORDER BY ls.priority LIMIT 1`,
    )
    .bind(address.delivery_zone_code ?? "", cycle.market_id)
    .first<{ zone_id: string; location_id: string; location_name: string }>();
  if (!routing)
    return failure(
      "ADDRESS_UNSERVICEABLE",
      "Address has no eligible fulfillment location",
      command.requestId,
    );

  // Capacity at the routed zone/location.
  const capacity = await database
    .prepare(
      "SELECT capacity, allocated FROM cycle_zone_capacity WHERE cycle_id=? AND zone_id=? AND location_id=?",
    )
    .bind(cycle.id, routing.zone_id, routing.location_id)
    .first<{ capacity: number; allocated: number }>();
  if (!capacity || capacity.allocated >= capacity.capacity)
    return failure("CAPACITY_UNAVAILABLE", "No remaining delivery capacity", command.requestId);

  // Location-aware pricing with fallback to market price. Missing price fails.
  const now2 = Date.now();
  const lines: QuoteLine[] = [];
  let subtotalMinor = 0;
  for (const item of cartItems.results) {
    const price = await database
      .prepare(
        `SELECT amount_minor FROM price_version pv JOIN delivery_cycle dc ON dc.id=?
         WHERE pv.sku_id=? AND pv.market_id=dc.market_id AND pv.currency=(SELECT currency FROM market WHERE id=dc.market_id)
           AND pv.price_type='STANDARD' AND (pv.location_id IS NULL OR pv.location_id=?)
           AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
         ORDER BY (pv.location_id IS NOT NULL) DESC, pv.version DESC LIMIT 1`,
      )
      .bind(cycle.id, item.sku_id, routing.location_id, now2, now2)
      .first<{ amount_minor: number }>();
    if (!price)
      return failure(
        "PRICE_CHANGED",
        `No authoritative price for ${item.sku_id}`,
        command.requestId,
      );
    const availability = await database
      .prepare(
        "SELECT status FROM location_product_availability WHERE location_id=? AND product_id=?",
      )
      .bind(routing.location_id, item.product_id)
      .first<{ status: string }>();
    if (availability && availability.status !== "available")
      return failure(
        "UNAVAILABLE_ITEM",
        `${item.product_name} is unavailable at this location`,
        command.requestId,
      );
    const baseQuantity = item.quantity * item.consumption_base_quantity;
    const lineTotal = price.amount_minor * item.quantity;
    subtotalMinor += lineTotal;
    lines.push({
      skuId: item.sku_id,
      productId: item.product_id,
      productName: item.product_name,
      variantName: item.variant_name,
      unit: item.unit,
      quantity: item.quantity,
      baseQuantity,
      unitPriceMinor: price.amount_minor,
      lineTotalMinor: lineTotal,
      sourcingMode: item.sourcing_mode,
    });
  }

  const quoteId = crypto.randomUUID();
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  try {
    await database.batch([
      repository.insertQuote(
        {
          id: quoteId,
          attemptId: quoteId,
          customerId: command.customerId,
          cartId: command.cartId,
          addressId: command.addressId,
          deliveryCycleId: command.deliveryCycleId,
          currency: "PHP",
          subtotalMinor,
          discountMinor: 0,
          deliveryFeeMinor: 0,
          totalMinor: subtotalMinor,
          lines,
          addressSnapshot: address,
          cycleSnapshot: {
            cycleId: cycle.id,
            cutoffAt: new Date(cycle.cutoff_at).toISOString(),
            deliveryDate: new Date(cycle.delivery_date).toISOString(),
            zoneId: routing.zone_id,
            locationId: routing.location_id,
            locationName: routing.location_name,
          },
          fulfillmentSnapshot: {
            fulfillmentMode: "SCHEDULED",
            sourcingModes: [...new Set(lines.map((line) => line.sourcingMode))],
            poolIds: [...new Set(cartItems.results.map((item) => item.inventory_pool_id))],
          },
          status: "ACTIVE",
          version: 1,
          expiresAt,
          idempotencyKey: command.idempotencyKey,
        },
        Date.now(),
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
  void now;
  const stored = await repository.findQuoteById(quoteId);
  return stored
    ? { ok: true, value: viewFrom(stored), requestId: command.requestId }
    : failure("INTERNAL_ERROR", "Quote persistence failed", command.requestId);
}

export async function refreshCheckoutQuote(
  database: D1Database,
  input: { quoteId: string; expectedVersion: number; requestId: string },
): Promise<{ ok: true; value: CheckoutQuoteView; requestId: string } | ReturnType<typeof failure>> {
  const repository = createCheckoutRepository(database);
  const quote = await repository.findQuoteById(input.quoteId);
  if (!quote) return failure("NOT_FOUND", "Quote not found", input.requestId);
  const now = Date.now();
  if (quote.expiresAt <= now || quote.status !== "ACTIVE")
    return failure("QUOTE_EXPIRED", "Quote expired; create a new one", input.requestId);
  const updated = await database
    .prepare(
      "UPDATE checkout_quote SET version=version+1, updated_at=? WHERE id=? AND version=? AND status='ACTIVE'",
    )
    .bind(now, quote.id, input.expectedVersion)
    .run()
    .then((result) => (result.meta?.changes ?? 0) === 1);
  if (!updated)
    return failure("CONFLICT", "Quote changed concurrently; refresh again", input.requestId);
  const fresh = await repository.findQuoteById(quote.id);
  return fresh
    ? { ok: true, value: viewFrom(fresh), requestId: input.requestId }
    : failure("INTERNAL_ERROR", "Refresh failed", input.requestId);
}

function viewFrom(row: CheckoutQuoteRow): CheckoutQuoteView {
  return {
    quoteId: row.id,
    attemptVersion: row.version,
    expiresAt: new Date(row.expiresAt).toISOString(),
    currency: row.currency,
    subtotalMinor: row.subtotalMinor,
    discountMinor: row.discountMinor,
    deliveryFeeMinor: row.deliveryFeeMinor,
    totalMinor: row.totalMinor,
    lines: row.lines,
  };
}
