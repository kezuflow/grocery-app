import type { FulfillmentOptionView, RpcResult } from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import type { RouteDistancePort } from "../../geography/ports/route-distance";
import { operationalCandidates } from "../../geography/application/operational-candidates";
import { requireSellingOpen } from "../../commerce/application/global-commerce-configuration";
import type { DeliveryProvider } from "../../delivery/ports/delivery-provider";
import { quoteProviderDelivery } from "./quote-provider-delivery";
import { MAX_ORDER_WEIGHT_GRAMS } from "../../fulfillment/domain/delivery-package";

type Query = {
  customerId: string;
  addressId: string;
  addressVersion?: number;
  cartId: string;
  cartVersion: number;
  requestId: string;
};

type InstantDeliveryPartner = Readonly<{
  providerCode: "lalamove" | "grab-express";
  displayName: string;
  serviceType: string;
  serviceLabel: string;
  provider: DeliveryProvider;
}>;
async function optionId(
  query: Query & { addressVersion: number },
  mode: string,
  evidence: unknown,
) {
  return `fulfillment_${(await requestHash({ customerId: query.customerId, addressId: query.addressId, addressVersion: query.addressVersion, cartId: query.cartId, cartVersion: query.cartVersion, mode, evidence })).slice(0, 48)}`;
}

export async function listFulfillmentOptions(
  database: D1Database,
  routeDistance: RouteDistancePort,
  query: Query,
  dependencies: Readonly<{
    instantDeliveryPartners?: readonly InstantDeliveryPartner[];
    scheduledDeliveryPartner?: InstantDeliveryPartner;
  }> = {},
): Promise<RpcResult<readonly FulfillmentOptionView[]>> {
  void routeDistance;
  const selling = await requireSellingOpen(database, query.requestId);
  if (!selling.ok) return selling;
  const address = await database
    .prepare(
      `SELECT recipient,phone,address_json,address_components_json,delivery_instructions_json,
              barangay,city,postal_code,latitude,longitude,version,delivery_zone_code,
              user_confirmed_at,serviceable,status
     FROM customer_address WHERE id=? AND customer_id=?`,
    )
    .bind(query.addressId, query.customerId)
    .first<{
      latitude: number;
      longitude: number;
      version: number;
      delivery_zone_code: string | null;
      user_confirmed_at: number | null;
      serviceable: number | null;
      status: string;
      recipient: string;
      phone: string;
      address_json: string;
      address_components_json: string | null;
      delivery_instructions_json: string | null;
      barangay: string | null;
      city: string | null;
      postal_code: string | null;
    }>();
  const cart = await database
    .prepare("SELECT version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'")
    .bind(query.cartId, query.customerId)
    .first<{ version: number }>();
  if (!address || !cart)
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Checkout input not found", requestId: query.requestId },
    };
  if (
    (query.addressVersion !== undefined && address.version !== query.addressVersion) ||
    cart.version !== query.cartVersion
  )
    return {
      ok: false,
      error: {
        code: "STALE_VERSION",
        message: "Address or cart changed",
        requestId: query.requestId,
      },
    };
  const itemCount = await database
    .prepare(`SELECT COUNT(*) count,
      SUM(CASE WHEN unit.canonical_base_code='GRAM' THEN item.quantity*sku.consumption_base_quantity
        ELSE item.quantity*sku.estimated_shipping_weight_grams END) grams
      FROM cart_item item JOIN sku ON sku.id=item.sku_id JOIN product ON product.id=sku.product_id
      JOIN inventory_pool pool ON pool.id=COALESCE(sku.stock_pool_id,product.inventory_pool_id)
      JOIN unit ON unit.id=pool.base_unit_id WHERE item.cart_id=?`)
    .bind(query.cartId)
    .first<{ count: number; grams: number | null }>();
  if (!itemCount?.count)
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Cart is empty", requestId: query.requestId },
    };
  if ((itemCount.grams ?? 0) > MAX_ORDER_WEIGHT_GRAMS)
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "An order including additions cannot exceed 20 kg",
        requestId: query.requestId,
      },
    };
  if (
    address.status !== "active" ||
    !address.user_confirmed_at ||
    address.serviceable !== 1 ||
    !address.delivery_zone_code
  )
    return {
      ok: false,
      error: {
        code: "ADDRESS_NOT_SERVICEABLE",
        message: "Confirm a serviceable address first",
        requestId: query.requestId,
      },
    };

  const orderedCandidates = await operationalCandidates(database, address);
  let candidate = orderedCandidates[0] ?? null;
  const currentQuery = { ...query, addressVersion: address.version };
  const options: FulfillmentOptionView[] = [];
  for (const mode of [selling.configuration.fulfillment_mode]) {
    let reason: FulfillmentOptionView["unavailableReason"] = candidate ? null : "MODE_UNAVAILABLE";
    type CycleWindow = {
      id: string;
      cutoff: number;
      delivery: number;
      version: number;
      windowId: string;
      windowName: string;
      startsAt: number;
      endsAt: number;
      pickupAt: number;
    };
    let cycles: CycleWindow[] = [];
    if (candidate && mode === "INSTANT") {
      const unavailable = await database
        .prepare(
          `SELECT 1 found FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN product p ON p.id=s.product_id
         LEFT JOIN inventory_balance b ON b.location_id=? AND b.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id)
         WHERE ci.cart_id=? AND (COALESCE(b.on_hand-b.reserved,0)-COALESCE((SELECT SUM(h.quantity) FROM checkout_inventory_holds h WHERE h.location_id=? AND h.inventory_pool_id=COALESCE(s.stock_pool_id,p.inventory_pool_id) AND h.status='HELD'),0) < ci.quantity*s.consumption_base_quantity) LIMIT 1`,
        )
        .bind(candidate.locationId, query.cartId, candidate.locationId)
        .first();
      if (unavailable) reason = "INVENTORY_UNAVAILABLE";
      if (reason === null) {
        const missingDeliveryWeight = await database
          .prepare(
            `SELECT 1 found
             FROM cart_item ci
             JOIN sku s ON s.id=ci.sku_id
             JOIN product p ON p.id=s.product_id
             JOIN inventory_pool ip ON ip.id=COALESCE(s.stock_pool_id,p.inventory_pool_id)
             JOIN unit bu ON bu.id=ip.base_unit_id
             WHERE ci.cart_id=? AND bu.canonical_base_code<>'GRAM'
               AND s.estimated_shipping_weight_grams IS NULL
             LIMIT 1`,
          )
          .bind(query.cartId)
          .first();
        if (missingDeliveryWeight) reason = "DELIVERY_WEIGHT_UNAVAILABLE";
      }
    }
    if (candidate && mode === "SCHEDULED") {
      for (const operationalCandidate of orderedCandidates) {
        const availableCycles = await database
          .prepare(
            `SELECT dc.id,dc.cutoff_at cutoff,dc.delivery_date delivery,dc.version,
              w.id windowId,w.name windowName,w.starts_at startsAt,w.ends_at endsAt,s.pickup_at pickupAt
         FROM delivery_cycle dc JOIN delivery_cycle_zone cycle_zone ON cycle_zone.cycle_id=dc.id
          AND cycle_zone.zone_id=? AND cycle_zone.location_id=? AND cycle_zone.status='ACTIVE'
         JOIN delivery_cycle_schedule s ON s.cycle_id=dc.id JOIN delivery_cycle_window w ON w.cycle_id=dc.id
         WHERE dc.market_id=? AND dc.status='OPEN' AND dc.cutoff_at>? AND dc.order_opens_at<=?
           AND dc.id IN (SELECT value FROM json_each(?))
           AND s.pickup_at<=w.starts_at AND w.starts_at<w.ends_at
         ORDER BY dc.delivery_date,dc.id,w.starts_at,w.id LIMIT 30`,
          )
          .bind(
            operationalCandidate.zoneId,
            operationalCandidate.locationId,
            operationalCandidate.marketId,
            Date.now(),
            Date.now(),
            JSON.stringify(operationalCandidate.eligibleCycleIds),
          )
          .all<CycleWindow>();
        if (availableCycles.results.length) {
          candidate = operationalCandidate;
          // Present every configured window of the next eligible cycle, as one offering.
          cycles = availableCycles.results.filter(
            (window) => window.id === availableCycles.results[0]?.id,
          );
          break;
        }
      }
      if (!cycles.length) reason = "CYCLE_UNAVAILABLE";
    }
    if (candidate && reason === null) {
      const unavailableCatalogItem = await database
        .prepare(
          `SELECT 1 found
           FROM cart_item ci
           JOIN sku s ON s.id=ci.sku_id
           JOIN product p ON p.id=s.product_id
           LEFT JOIN sku_location_availability availability
             ON availability.sku_id=s.id AND availability.location_id=?
           WHERE ci.cart_id=? AND (
             s.status<>'active' OR p.status<>'active'
             OR availability.availability_status IS NULL
             OR availability.availability_status<>'AVAILABLE'
             OR NOT EXISTS (
               SELECT 1 FROM price_version price
               WHERE price.sku_id=s.id AND price.market_id=? AND price.location_id=?
                 AND price.price_type='STANDARD' AND price.amount_minor>0
                 AND price.valid_from<=? AND (price.valid_to IS NULL OR price.valid_to>?)
             )
           ) LIMIT 1`,
        )
        .bind(
          candidate.locationId,
          query.cartId,
          candidate.marketId,
          candidate.locationId,
          Date.now(),
          Date.now(),
        )
        .first();
      if (unavailableCatalogItem) reason = "CATALOG_UNAVAILABLE";
    }
    const partners =
      mode === "INSTANT"
        ? dependencies.instantDeliveryPartners?.length
          ? dependencies.instantDeliveryPartners
          : [null]
        : [dependencies.scheduledDeliveryPartner ?? null];
    for (const cycle of cycles.length ? cycles : [null]) {
      for (const partner of partners) {
        let optionReason: FulfillmentOptionView["unavailableReason"] =
          !partner && reason === null
            ? mode === "INSTANT"
              ? "DELIVERY_PARTNER_UNAVAILABLE"
              : "FEE_UNAVAILABLE"
            : reason;
        let fee: FulfillmentOptionView["feePreview"] = null;
        if (candidate && partner && optionReason === null) {
          const now = Date.now();
          const quoted = await quoteProviderDelivery(database, partner.provider, {
            providerCode: partner.providerCode,
            serviceType: partner.serviceType,
            marketId: candidate.marketId,
            locationId: candidate.locationId,
            cartId: query.cartId,
            address,
            scheduleAt:
              mode === "SCHEDULED" && cycle ? new Date(cycle.pickupAt).toISOString() : null,
            now,
          });
          if (!quoted) optionReason = "FEE_UNAVAILABLE";
          else
            fee = {
              subtotalMinor: quoted.feeMinor,
              discountMinor: 0,
              totalMinor: quoted.feeMinor,
              currency: quoted.snapshot.currency,
            };
        }
        const evidence = candidate
          ? {
              locationId: candidate.locationId,
              modeVersion: candidate.modeVersion,
              geographyVersion: candidate.geographyVersion,
              cycle,
              ...(partner
                ? { providerCode: partner.providerCode, providerServiceType: partner.serviceType }
                : {}),
            }
          : { unavailable: true };
        options.push({
          optionId: await optionId(currentQuery, mode, evidence),
          mode,
          eligible: optionReason === null,
          unavailableReason: optionReason,
          deliveryPartner:
            mode === "INSTANT" && partner
              ? {
                  code: partner.providerCode,
                  displayName: partner.displayName,
                  serviceType: partner.serviceType,
                  serviceLabel: partner.serviceLabel,
                }
              : null,
          promisedAt:
            mode === "INSTANT" && candidate?.promiseMinutes
              ? new Date(Date.now() + candidate.promiseMinutes * 60_000).toISOString()
              : null,
          deliveryWindow: cycle
            ? {
                windowId: cycle.windowId,
                name: cycle.windowName,
                startsAt: new Date(cycle.startsAt).toISOString(),
                endsAt: new Date(cycle.endsAt).toISOString(),
              }
            : null,
          feePreview: fee,
          cycleId: cycle?.id ?? null,
          cutoffAt: cycle ? new Date(cycle.cutoff).toISOString() : null,
          provisional: true,
        });
      }
    }
  }
  return { ok: true, value: options, requestId: query.requestId };
}
