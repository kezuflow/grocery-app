import {
  totalShippingWeightGrams,
  MAX_ORDER_WEIGHT_GRAMS,
} from "../../fulfillment/domain/delivery-package";
import {
  operatingScheduleGuard,
  scheduledOperatingInterval,
} from "../../geography/application/operating-schedule-guard";
import {
  createCheckoutRepository,
  type CheckoutQuoteRow,
} from "../infrastructure/d1-checkout-repository";
import type { AppErrorCode, FulfillmentOptionView } from "@freshmarkets/contracts";
import type { QuoteLine } from "../domain/quote";
import { QUOTE_TTL_MS } from "../domain/quote";
import { cartHasUnsettledCheckout, quoteRefreshPaymentGuard } from "./release-uncommitted-checkout";
import { createInstantQuote, type QuoteItem } from "./instant-quote";
import { resolveLineShippingWeightGrams } from "../../fulfillment/domain/delivery-package";
import type { RouteDistancePort } from "../../geography/ports/route-distance";
import { resolveCheckoutDecision } from "./resolve-checkout-decision";
import type {
  CheckoutPromotionApplicationView,
  PromotionCodeFeedback,
} from "@freshmarkets/contracts";
import {
  evaluateCheckoutPromotions,
  promotionClaimStatements,
} from "../../promotions/application/evaluate-checkout-promotions";
import {
  operationalCandidates,
  geographyQuoteGuard,
} from "../../geography/application/operational-candidates";
import { requireSellingOpen } from "../../commerce/application/global-commerce-configuration";
import type { DeliveryProvider } from "../../delivery/ports/delivery-provider";
import { quoteProviderDelivery, type ProviderCheckoutAddress } from "./quote-provider-delivery";
import {
  selectScheduledWindow,
  scheduledWindowGuard,
  scheduledWindowSnapshotSchema,
} from "../../commerce/application/scheduled-window";

export type CreateCheckoutQuoteCommand = {
  customerId: string;
  cartId: string;
  cartVersion: number;
  addressId: string;
  /** Null selects the INSTANT path; a cycle id selects SCHEDULED. */
  deliveryCycleId: string | null;
  /** Server-resolved configured window. A sole window is unambiguous for internal callers. */
  deliveryWindowId?: string;
  /** Opaque customer selection resolved by the RPC adapter. */
  fulfillmentOptionId?: string;
  /** Server-resolved Instant partner metadata; never accepted as client authority. */
  deliveryPartner?: FulfillmentOptionView["deliveryPartner"];
  promotionCodes?: readonly string[];
  idempotencyKey: string;
  requestId: string;
};

export type CheckoutQuoteDependencies = {
  /** Retained until route-distance compatibility callers are retired. */
  routeDistance: RouteDistancePort;
  deliveryProviders?: ReadonlyMap<string, DeliveryProvider>;
  scheduledDeliveryPartner?: Readonly<{ providerCode: string; serviceType: string }>;
  defaultInstantDeliveryPartner?: NonNullable<FulfillmentOptionView["deliveryPartner"]>;
};

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
 * eligibility, serviceability, cycle/cutoff, availability, and pricing are all
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
    const savedWindow = scheduledWindowSnapshotSchema.safeParse(
      existing.cycleSnapshot &&
        typeof existing.cycleSnapshot === "object" &&
        "deliveryWindow" in existing.cycleSnapshot
        ? existing.cycleSnapshot.deliveryWindow
        : null,
    );
    const existingOptionId =
      existing.fulfillmentSnapshot && typeof existing.fulfillmentSnapshot === "object"
        ? (existing.fulfillmentSnapshot as { fulfillmentOptionId?: unknown }).fulfillmentOptionId
        : undefined;
    if (
      existing.customerId !== command.customerId ||
      existing.cartId !== command.cartId ||
      existing.addressId !== command.addressId ||
      (existing.deliveryCycleId ?? null) !== (command.deliveryCycleId ?? null) ||
      (command.deliveryWindowId !== undefined &&
        (!savedWindow.success || savedWindow.data.windowId !== command.deliveryWindowId)) ||
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

  const selling = await requireSellingOpen(database, command.requestId);
  if (!selling.ok) return selling;

  // Cart identity and version.
  const cart = await database
    .prepare("SELECT id, customer_id, version FROM cart WHERE id=? AND status='ACTIVE'")
    .bind(command.cartId)
    .first<{ id: string; customer_id: string; version: number }>();
  if (!cart || cart.customer_id !== command.customerId)
    return failure("NOT_FOUND", "Active cart not found", command.requestId);
  if (await cartHasUnsettledCheckout(database, command.cartId))
    return failure(
      "CONFLICT",
      "A payment for this cart is still being settled. Check that checkout before requesting a new total.",
      command.requestId,
    );
  if (cart.version !== command.cartVersion)
    return failure(
      "CART_VERSION_CONFLICT",
      "Cart changed; refresh before quoting",
      command.requestId,
    );

  const cartItems = await database
    .prepare(
      `SELECT ci.sku_id, ci.quantity, s.name AS variant_name, s.sellable_unit_id AS unit,
              s.consumption_base_quantity, s.estimated_shipping_weight_grams,
              bu.canonical_base_code AS base_unit_code,
              p.id AS product_id, p.name AS product_name, p.category_id, COALESCE(s.stock_pool_id,p.inventory_pool_id) AS inventory_pool_id
       FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN product p ON p.id=s.product_id
       JOIN inventory_pool ip ON ip.id=COALESCE(s.stock_pool_id,p.inventory_pool_id)
       JOIN unit bu ON bu.id=ip.base_unit_id
       WHERE ci.cart_id=? AND s.status='active' AND p.status='active'`,
    )
    .bind(command.cartId)
    .all<{
      sku_id: string;
      quantity: number;
      variant_name: string;
      unit: string;
      consumption_base_quantity: number;
      base_unit_code: "GRAM" | "MILLILITER" | "PIECE";
      estimated_shipping_weight_grams: number | null;
      product_id: string;
      product_name: string;
      category_id: string;
      inventory_pool_id: string;
    }>();
  if (cartItems.results.length === 0)
    return failure("VALIDATION_FAILED", "Cart is empty", command.requestId);
  // Address serviceability evidence shared by both fulfillment modes.
  const address = await database
    .prepare("SELECT * FROM customer_address WHERE id=? AND customer_id=? AND status='active'")
    .bind(command.addressId, command.customerId)
    .first<ProviderCheckoutAddress & { delivery_zone_code: string | null }>();
  if (!address) return failure("NOT_FOUND", "Customer address not found", command.requestId);

  const globalMode = selling.configuration.fulfillment_mode;
  if (globalMode === "INSTANT" && command.deliveryCycleId !== null)
    return failure(
      "INSTANT_MODE_UNAVAILABLE",
      "FreshMarkets is currently in Instant mode",
      command.requestId,
    );
  if (globalMode === "SCHEDULED" && command.deliveryCycleId === null)
    return failure(
      "CYCLE_CLOSED",
      "FreshMarkets is currently in Scheduled mode",
      command.requestId,
    );
  const modeItems: QuoteItem[] = cartItems.results;
  if (globalMode === "INSTANT")
    return createInstantQuote(
      database,
      repository,
      {
        ...command,
        deliveryPartner: command.deliveryPartner ?? dependencies.defaultInstantDeliveryPartner,
      },
      modeItems,
      address,
      dependencies,
    );
  return createScheduledQuote(
    database,
    repository,
    { ...command, deliveryCycleId: command.deliveryCycleId! },
    modeItems,
    address,
    dependencies,
  );
}

/** Scheduled path: open window, exact-location active catalog, and priced lines. */
async function createScheduledQuote(
  database: D1Database,
  repository: ReturnType<typeof createCheckoutRepository>,
  command: CreateCheckoutQuoteCommand & { deliveryCycleId: string },
  items: readonly QuoteItem[],
  address: ProviderCheckoutAddress & { delivery_zone_code: string | null },
  dependencies: CheckoutQuoteDependencies,
): Promise<{ ok: true; value: CheckoutQuoteView; requestId: string } | ReturnType<typeof failure>> {
  // Cycle must be open and before cutoff.
  const cycle = await database
    .prepare(
      "SELECT id, version, market_id, order_opens_at, cutoff_at, delivery_date, status FROM delivery_cycle WHERE id=? AND status='OPEN'",
    )
    .bind(command.deliveryCycleId)
    .first<{
      id: string;
      version: number;
      market_id: string;
      cutoff_at: number;
      order_opens_at: number;
      delivery_date: number;
      status: string;
    }>();
  const now = Date.now();
  if (!cycle) return failure("CYCLE_CLOSED", "The delivery cycle is not open", command.requestId);
  if (cycle.order_opens_at > now)
    return failure("CYCLE_CLOSED", "Orders have not opened for this cycle", command.requestId);
  if (cycle.cutoff_at <= now)
    return failure("CYCLE_CLOSED", "The cycle cutoff has passed", command.requestId);
  const window = await selectScheduledWindow(database, cycle.id, command.deliveryWindowId);
  if (!window)
    return failure(
      "CYCLE_CLOSED",
      "Choose an available configured delivery window",
      command.requestId,
    );

  // Zone routing for this cycle's market (address already resolved).
  const selected = (
    await operationalCandidates(database, address, {
      mode: "SCHEDULED",
      marketId: cycle.market_id,
      cycleId: cycle.id,
    })
  )[0];
  const routing = selected
    ? {
        ...selected,
        zone_id: selected.zoneId,
        market_id: selected.marketId,
        location_id: selected.locationId,
        location_name: selected.locationName,
        promise_minutes: selected.promiseMinutes,
      }
    : null;
  if (!routing)
    return failure(
      "ADDRESS_UNSERVICEABLE",
      "Address has no eligible fulfillment location",
      command.requestId,
    );

  // Exact-location pricing. Missing price fails; no Market fallback exists.
  const openInterval = scheduledOperatingInterval(routing, Date.parse(window.pickupAt));
  if (!openInterval)
    return failure("CYCLE_CLOSED", "The location is closed at planned pickup", command.requestId);
  const now2 = Date.now();
  const lines: QuoteLine[] = [];
  let subtotalMinor = 0;
  for (const item of items) {
    const price = await database
      .prepare(
        `SELECT amount_minor FROM price_version pv JOIN delivery_cycle dc ON dc.id=?
         WHERE pv.sku_id=? AND pv.market_id=dc.market_id AND pv.currency=(SELECT currency FROM market WHERE id=dc.market_id)
           AND pv.price_type='STANDARD' AND pv.location_id=? AND pv.amount_minor>0
           AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
         ORDER BY pv.version DESC LIMIT 1`,
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
      baseUnitCode: item.base_unit_code,
      shippingWeightGrams: resolveLineShippingWeightGrams({
        baseUnitCode: item.base_unit_code,
        quantity: item.quantity,
        baseQuantity,
        estimatedShippingWeightGrams: item.estimated_shipping_weight_grams,
      }),
      unitPriceMinor: price.amount_minor,
      lineTotalMinor: lineTotal,
    });
  }

  const orderWeight = totalShippingWeightGrams(lines.map((line) => line.shippingWeightGrams));
  if (orderWeight === null)
    return failure(
      "CONFIGURATION_ERROR",
      "Delivery weight is unavailable for one or more items",
      command.requestId,
    );
  if (orderWeight > MAX_ORDER_WEIGHT_GRAMS)
    return failure(
      "VALIDATION_FAILED",
      "An order including additions cannot exceed 20 kg",
      command.requestId,
    );
  const scheduledPartner = dependencies.scheduledDeliveryPartner;
  const scheduledProvider = scheduledPartner
    ? dependencies.deliveryProviders?.get(scheduledPartner.providerCode)
    : null;
  if (!scheduledPartner || !scheduledProvider)
    return failure(
      "CONFIGURATION_ERROR",
      "Scheduled delivery pricing is unavailable",
      command.requestId,
    );
  const deliveryFee = await quoteProviderDelivery(database, scheduledProvider, {
    providerCode: scheduledPartner.providerCode,
    serviceType: scheduledPartner.serviceType,
    marketId: cycle.market_id,
    locationId: routing.location_id,
    cartId: command.cartId,
    address,
    scheduleAt: window.pickupAt,
    now: now2,
  });
  if (!deliveryFee)
    return failure(
      "CONFIGURATION_ERROR",
      "Scheduled delivery quotation is unavailable",
      command.requestId,
    );

  const quoteId = crypto.randomUUID();
  const expiresAt = Math.min(Date.now() + QUOTE_TTL_MS, Date.parse(deliveryFee.snapshot.expiresAt));
  const requestedPromotionCodes = (command.promotionCodes ?? []).map((code) =>
    code.trim().toUpperCase(),
  );
  const promotion = await evaluateCheckoutPromotions(database, {
    cartId: command.cartId,
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
  const merchandiseDiscount = promotion.applications
    .filter((application) => application.component === "MERCHANDISE")
    .reduce((sum, application) => sum + application.amountMinor, 0);
  const itemDiscount = promotion.applications
    .filter((application) => application.kind === "PRODUCT_SALE")
    .reduce((sum, application) => sum + application.amountMinor, 0);
  const deliveryDiscount =
    promotion.applications.find((application) => application.component === "DELIVERY")
      ?.amountMinor ?? 0;
  const promotionApplications = promotion.applications.map((application) => ({
    ...(application.kind ? { kind: application.kind, lines: application.lines } : {}),
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
    itemDiscountMinor: itemDiscount,
    orderDiscountMinor: merchandiseDiscount - itemDiscount,
    deliverySubtotalMinor: deliveryFee.feeMinor,
    deliveryDiscountMinor: deliveryDiscount,
    serviceFeeMinor: 0,
    taxMinor: 0,
    totalMinor: subtotalMinor - merchandiseDiscount + deliveryFee.feeMinor - deliveryDiscount,
    currency: deliveryFee.snapshot.currency,
  };
  const preServiceFeeTotalMinor = financial.totalMinor;
  const decision = await resolveCheckoutDecision(database, {
    marketId: cycle.market_id,
    financial,
    evidence: {
      lines,
      addressSnapshot: address,
      cycleSnapshot: {
        cycleVersion: cycle.version,
        geographyVersion: routing.geographyVersion,
        locationVersion: routing.locationVersion,
        operatingInterval: openInterval,
        readinessVersion: routing.readinessVersion,
        modeVersion: routing.modeVersion,
        cycleId: cycle.id,
        cutoffAt: new Date(cycle.cutoff_at).toISOString(),
        deliveryDate: window.startsAt,
        deliveryWindow: window,
        zoneId: routing.zone_id,
        locationId: routing.location_id,
        locationName: routing.location_name,
      },
      fulfillmentSnapshot: {
        fulfillmentOptionId: command.fulfillmentOptionId ?? null,
        fulfillmentMode: "SCHEDULED" as const,
        deliveryExecution: {
          selectedBy: "OPERATIONS" as const,
          method: null,
          providerCode: null,
          providerServiceType: null,
        },
        poolIds: [...new Set(items.map((item) => item.inventory_pool_id))],
      },
      deliveryFeeSnapshot: deliveryFee.snapshot,
    },
  });
  if (!decision.eligible) {
    const code = decision.failures[0] ?? "CONFIGURATION_ERROR";
    return failure(code, "Checkout market configuration is unavailable", command.requestId);
  }
  const evidence = decision.evidence!;
  try {
    await database.batch([
      repository.guardCartVersion(command.cartId, command.customerId, command.cartVersion),
      quoteRefreshPaymentGuard(database, command.cartId),
      geographyQuoteGuard(database, routing, cycle),
      operatingScheduleGuard(database, routing, openInterval, Date.parse(window.pickupAt)),
      scheduledWindowGuard(database, cycle.id, window),
      repository.insertQuote(
        {
          id: quoteId,
          attemptId: quoteId,
          customerId: command.customerId,
          cartId: command.cartId,
          cartVersion: command.cartVersion,
          addressId: command.addressId,
          deliveryCycleId: command.deliveryCycleId,
          currency: decision.currency,
          financial,
          preServiceFeeTotalMinor,
          serviceFeeConfigurationId: null,
          serviceFeeSnapshot: null,
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
    const currentCart = await database
      .prepare("SELECT version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'")
      .bind(command.cartId, command.customerId)
      .first<{ version: number }>();
    if (currentCart?.version !== command.cartVersion)
      return failure(
        "CART_VERSION_CONFLICT",
        "Your cart changed. Review it before requesting a new total.",
        command.requestId,
      );
    const refreshed = (
      await operationalCandidates(database, address, {
        mode: routing.mode,
        marketId: routing.marketId,
        cycleId: cycle.id,
      })
    )[0];
    if (
      !refreshed ||
      refreshed.locationId !== routing.locationId ||
      refreshed.zoneId !== routing.zoneId ||
      refreshed.locationVersion !== routing.locationVersion ||
      refreshed.readinessVersion !== routing.readinessVersion
    )
      return failure(
        "PRICE_CHANGED",
        "Fulfillment routing changed; request a new quote",
        command.requestId,
      );
    const currentCycle = await database
      .prepare("SELECT version FROM delivery_cycle WHERE id=?")
      .bind(cycle.id)
      .first<{ version: number }>();
    if (currentCycle?.version !== cycle.version)
      return failure(
        "PRICE_CHANGED",
        "Scheduled window changed; request a new quote",
        command.requestId,
      );
    const currentGeography = await database
      .prepare("SELECT version FROM geography_configuration WHERE market_id=?")
      .bind(routing.market_id)
      .first<{ version: number }>();
    const currentMode = await database
      .prepare("SELECT version,selling_state FROM global_commerce_configuration WHERE id='global'")
      .first<{ version: number; selling_state: string }>();
    if (
      currentGeography?.version !== routing.geographyVersion ||
      currentMode?.version !== routing.modeVersion ||
      currentMode.selling_state !== "OPEN"
    )
      return failure(
        "PRICE_CHANGED",
        "Fulfillment routing changed; request a new quote",
        command.requestId,
      );

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
