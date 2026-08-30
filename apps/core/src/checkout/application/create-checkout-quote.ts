import {
  createCheckoutRepository,
  type CheckoutQuoteRow,
} from "../infrastructure/d1-checkout-repository";
import type { AppErrorCode } from "@freshmarkets/contracts";
import type { QuoteLine } from "../domain/quote";
import { QUOTE_TTL_MS } from "../domain/quote";
import { createInstantQuote, type QuoteItem } from "./instant-quote";
import type { RouteDistancePort } from "../../geography/ports/route-distance";
import { quoteDeliveryFee } from "../../geography/application/quote-delivery-fee";
import { deliveryFeeFailure } from "./delivery-fee-failure";
import { evaluateSubscriptionEntitlement } from "../../membership/application/evaluate-subscription-entitlement";
import { resolveCheckoutDecision } from "./resolve-checkout-decision";
import type {
  CheckoutPromotionApplicationView,
  PromotionCodeFeedback,
} from "@freshmarkets/contracts";
import {
  evaluateCheckoutPromotions,
  promotionClaimStatements,
} from "../../promotions/application/evaluate-checkout-promotions";

export type CreateCheckoutQuoteCommand = {
  customerId: string;
  cartId: string;
  cartVersion: number;
  addressId: string;
  /** Null selects the INSTANT path; a cycle id selects SCHEDULED. */
  deliveryCycleId: string | null;
  /** Opaque customer selection resolved by the RPC adapter. */
  fulfillmentOptionId?: string;
  promotionCodes?: readonly string[];
  idempotencyKey: string;
  requestId: string;
};

export type CheckoutQuoteDependencies = { routeDistance: RouteDistancePort };

export type CheckoutQuoteView = {
  quoteId: string;
  attemptVersion: number;
  priceAcceptanceVersion: number;
  expiresAt: string;
  currency: string;
  merchandiseSubtotalMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  deliverySubtotalMinor: number;
  deliveryDiscountMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  lines: ReadonlyArray<QuoteLine>;
  requestedPromotionCodes: readonly string[];
  promotionFeedback: readonly PromotionCodeFeedback[];
  promotionApplications: readonly CheckoutPromotionApplicationView[];
};

function failure(code: AppErrorCode, message: string, requestId: string) {
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
  dependencies: CheckoutQuoteDependencies,
): Promise<{ ok: true; value: CheckoutQuoteView; requestId: string } | ReturnType<typeof failure>> {
  const repository = createCheckoutRepository(database);

  // Idempotent replay first: same key returns the same immutable quote.
  const existing = await repository.findQuoteByIdempotencyKey(command.idempotencyKey);
  if (existing) {
    const existingOptionId =
      existing.fulfillmentSnapshot && typeof existing.fulfillmentSnapshot === "object"
        ? (existing.fulfillmentSnapshot as { fulfillmentOptionId?: unknown }).fulfillmentOptionId
        : undefined;
    if (
      existing.customerId !== command.customerId ||
      existing.cartId !== command.cartId ||
      existing.addressId !== command.addressId ||
      (existing.deliveryCycleId ?? null) !== (command.deliveryCycleId ?? null) ||
      (command.fulfillmentOptionId !== undefined &&
        existingOptionId !== command.fulfillmentOptionId) ||
      JSON.stringify(existing.requestedPromotionCodes) !==
        JSON.stringify((command.promotionCodes ?? []).map((code) => code.trim().toUpperCase()))
    )
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    return { ok: true, value: viewFrom(existing), requestId: command.requestId };
  }

  // Membership entitlement at quote time.
  const membership = await evaluateSubscriptionEntitlement(database, {
    customerId: command.customerId,
    at: Date.now(),
  });
  if (!membership.eligible)
    return failure(
      "MEMBERSHIP_REQUIRED",
      "An active or trialing membership is required to check out",
      command.requestId,
    );

  // Cart identity and version.
  const cart = await database
    .prepare("SELECT id, customer_id, version FROM cart WHERE id=? AND status='ACTIVE'")
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
              p.id AS product_id, p.name AS product_name, p.category_id, p.inventory_pool_id,
              ip.canonical_sourcing_mode AS sourcing_mode
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
      category_id: string;
      inventory_pool_id: string;
      sourcing_mode: "STOCKED" | "PLANNED" | "ON_DEMAND" | "MIXED";
    }>();
  if (cartItems.results.length === 0)
    return failure("VALIDATION_FAILED", "Cart is empty", command.requestId);
  if (cartItems.results.some((item) => item.sourcing_mode === "ON_DEMAND"))
    return failure(
      "UNAVAILABLE_ITEM",
      "On-demand sourcing is not configured for current checkout",
      command.requestId,
    );

  // Address serviceability evidence shared by both fulfillment modes.
  const address = await database
    .prepare("SELECT * FROM customer_address WHERE id=? AND customer_id=? AND status='active'")
    .bind(command.addressId, command.customerId)
    .first<
      Record<string, unknown> & {
        delivery_zone_code: string | null;
        latitude: number;
        longitude: number;
      }
    >();
  if (!address) return failure("NOT_FOUND", "Customer address not found", command.requestId);

  // The routed location's active mode governs checkout semantics: a cycle id
  // selects Scheduled; no cycle id selects Instant where a location offers it.
  if (command.deliveryCycleId === null)
    return createInstantQuote(
      database,
      repository,
      command,
      cartItems.results,
      address,
      dependencies,
    );
  return createScheduledQuote(
    database,
    repository,
    { ...command, deliveryCycleId: command.deliveryCycleId },
    cartItems.results,
    address,
    dependencies,
  );
}

/** The existing Scheduled path: open-cycle, cutoff, capacity, priced lines. */
async function createScheduledQuote(
  database: D1Database,
  repository: ReturnType<typeof createCheckoutRepository>,
  command: CreateCheckoutQuoteCommand & { deliveryCycleId: string },
  items: readonly QuoteItem[],
  address: Record<string, unknown> & {
    delivery_zone_code: string | null;
    latitude: number;
    longitude: number;
  },
  dependencies: CheckoutQuoteDependencies,
): Promise<{ ok: true; value: CheckoutQuoteView; requestId: string } | ReturnType<typeof failure>> {
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

  // Zone routing for this cycle's market (address already resolved).
  const routing = await database
    .prepare(
      `SELECT dz.id AS zone_id, ls.location_id, fl.name AS location_name,
              fl.latitude, fl.longitude
       FROM delivery_zone dz JOIN service_area sa ON sa.id=dz.service_area_id
       JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1
       JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.status='active'
       WHERE dz.code=? AND dz.status='active' AND sa.market_id=?
       ORDER BY ls.priority LIMIT 1`,
    )
    .bind(address.delivery_zone_code ?? "", cycle.market_id)
    .first<{
      zone_id: string;
      location_id: string;
      location_name: string;
      latitude: number;
      longitude: number;
    }>();
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
  for (const item of items) {
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

  let deliveryFee;
  try {
    deliveryFee = await quoteDeliveryFee(database, dependencies.routeDistance, {
      marketId: cycle.market_id,
      locationId: routing.location_id,
      origin: { latitude: routing.latitude, longitude: routing.longitude },
      destination: { latitude: address.latitude, longitude: address.longitude },
      now: now2,
    });
  } catch (error) {
    return deliveryFeeFailure(error, command.requestId);
  }

  const quoteId = crypto.randomUUID();
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  const requestedPromotionCodes = (command.promotionCodes ?? []).map((code) =>
    code.trim().toUpperCase(),
  );
  const promotion = await evaluateCheckoutPromotions(database, {
    customerId: command.customerId,
    marketId: cycle.market_id,
    locationId: routing.location_id,
    fulfillmentMode: "SCHEDULED",
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
    at: now2,
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
  const financial = {
    merchandiseSubtotalMinor: subtotalMinor,
    itemDiscountMinor: 0,
    orderDiscountMinor: merchandiseDiscount,
    deliverySubtotalMinor: deliveryFee.feeMinor,
    deliveryDiscountMinor: deliveryDiscount,
    serviceFeeMinor: 0,
    taxMinor: 0,
    totalMinor: subtotalMinor - merchandiseDiscount + deliveryFee.feeMinor - deliveryDiscount,
    currency: deliveryFee.snapshot.currency,
  };
  const decision = await resolveCheckoutDecision(database, {
    marketId: cycle.market_id,
    financial,
    evidence: {
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
        fulfillmentOptionId: command.fulfillmentOptionId ?? null,
        fulfillmentMode: "SCHEDULED" as const,
        sourcingModes: [...new Set(lines.map((line) => line.sourcingMode))],
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
      repository.insertQuote(
        {
          id: quoteId,
          attemptId: quoteId,
          customerId: command.customerId,
          cartId: command.cartId,
          addressId: command.addressId,
          deliveryCycleId: command.deliveryCycleId,
          currency: decision.currency,
          financial,
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
        now2,
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

/**
 * Customer-scoped quote refresh: enforces that the quote exists and belongs
 * to the requesting customer before delegating to the versioned refresh
 * command. Ownership is authorization policy; it never widens the command.
 */
export async function refreshCustomerCheckoutQuote(
  database: D1Database,
  input: { quoteId: string; expectedVersion: number; requestId: string; customerId: string },
): Promise<{ ok: true; value: CheckoutQuoteView; requestId: string } | ReturnType<typeof failure>> {
  const repository = createCheckoutRepository(database);
  const quote = await repository.findQuoteById(input.quoteId);
  if (!quote || quote.customerId !== input.customerId)
    return failure("NOT_FOUND", "Quote not found", input.requestId);
  return refreshCheckoutQuote(database, {
    quoteId: input.quoteId,
    expectedVersion: input.expectedVersion,
    requestId: input.requestId,
  });
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
