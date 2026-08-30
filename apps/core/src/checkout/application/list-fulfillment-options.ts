import type { FulfillmentOptionView, RpcResult } from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import { quoteDeliveryFee } from "../../geography/application/quote-delivery-fee";
import type { RouteDistancePort } from "../../geography/ports/route-distance";

type Query = {
  customerId: string;
  addressId: string;
  addressVersion?: number;
  cartId: string;
  cartVersion: number;
  requestId: string;
};
type Candidate = {
  locationId: string;
  latitude: number;
  longitude: number;
  marketId: string;
  mode: "INSTANT" | "SCHEDULED";
  promiseMinutes: number | null;
  modeVersion: number;
  zoneId: string;
};

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
): Promise<RpcResult<readonly FulfillmentOptionView[]>> {
  const address = await database
    .prepare(
      `SELECT latitude,longitude,version,delivery_zone_code,user_confirmed_at,serviceable,status
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
    .prepare("SELECT COUNT(*) count FROM cart_item WHERE cart_id=?")
    .bind(query.cartId)
    .first<{ count: number }>();
  if (!itemCount?.count)
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Cart is empty", requestId: query.requestId },
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

  const candidates = await database
    .prepare(
      `SELECT fl.id locationId,fl.latitude,fl.longitude,fl.market_id marketId,
            fm.active_mode mode,fm.promise_minutes promiseMinutes,fm.version modeVersion,dz.id zoneId
     FROM delivery_zone dz JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1
     JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.status='active'
     JOIN fulfillment_location_mode fm ON fm.location_id=fl.id
     WHERE dz.code=? AND dz.status='active' ORDER BY ls.priority,fl.id`,
    )
    .bind(address.delivery_zone_code)
    .all<Candidate>();
  const currentQuery = { ...query, addressVersion: address.version };
  const options: FulfillmentOptionView[] = [];
  for (const mode of ["INSTANT", "SCHEDULED"] as const) {
    const candidate = candidates.results.find((row) => row.mode === mode);
    let reason: FulfillmentOptionView["unavailableReason"] = candidate ? null : "MODE_UNAVAILABLE";
    let cycle: { id: string; cutoff: number; delivery: number; version: number } | null = null;
    let fee: FulfillmentOptionView["feePreview"] = null;
    if (candidate && mode === "INSTANT") {
      const unavailable = await database
        .prepare(
          `SELECT 1 found FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN product p ON p.id=s.product_id
         LEFT JOIN inventory_balance b ON b.location_id=? AND b.inventory_pool_id=p.inventory_pool_id
         WHERE ci.cart_id=? AND (COALESCE(b.on_hand-b.reserved,0)-COALESCE((SELECT SUM(h.quantity) FROM checkout_inventory_holds h WHERE h.location_id=? AND h.inventory_pool_id=p.inventory_pool_id AND h.status='HELD'),0) < ci.quantity*s.consumption_base_quantity) LIMIT 1`,
        )
        .bind(candidate.locationId, query.cartId, candidate.locationId)
        .first();
      if (unavailable) reason = "INVENTORY_UNAVAILABLE";
    }
    if (candidate && mode === "SCHEDULED") {
      cycle = await database
        .prepare(
          `SELECT dc.id,dc.cutoff_at cutoff,dc.delivery_date delivery,dc.version
         FROM delivery_cycle dc JOIN cycle_zone_capacity c ON c.cycle_id=dc.id
          AND c.zone_id=? AND c.location_id=?
         WHERE dc.market_id=? AND dc.status='OPEN' AND dc.cutoff_at>? AND c.allocated<c.capacity
         ORDER BY dc.delivery_date,dc.id LIMIT 1`,
        )
        .bind(candidate.zoneId, candidate.locationId, candidate.marketId, Date.now())
        .first<{ id: string; cutoff: number; delivery: number; version: number }>();
      if (!cycle) reason = "CYCLE_UNAVAILABLE";
    }
    if (candidate && reason === null) {
      try {
        const quoted = await quoteDeliveryFee(database, routeDistance, {
          marketId: candidate.marketId,
          locationId: candidate.locationId,
          origin: { latitude: candidate.latitude, longitude: candidate.longitude },
          destination: { latitude: address.latitude, longitude: address.longitude },
          now: Date.now(),
        });
        fee = {
          subtotalMinor: quoted.feeMinor,
          discountMinor: 0,
          totalMinor: quoted.feeMinor,
          currency: quoted.snapshot.currency,
        };
      } catch {
        reason = "FEE_UNAVAILABLE";
      }
    }
    const evidence = candidate
      ? { locationId: candidate.locationId, modeVersion: candidate.modeVersion, cycle }
      : { unavailable: true };
    options.push({
      optionId: await optionId(currentQuery, mode, evidence),
      mode,
      eligible: reason === null,
      unavailableReason: reason,
      promisedAt:
        mode === "INSTANT" && candidate?.promiseMinutes
          ? new Date(Date.now() + candidate.promiseMinutes * 60_000).toISOString()
          : null,
      deliveryWindow: cycle
        ? {
            startsAt: new Date(cycle.delivery).toISOString(),
            endsAt: new Date(cycle.delivery + 24 * 60 * 60_000).toISOString(),
          }
        : null,
      feePreview: fee,
      cycleId: cycle?.id ?? null,
      cutoffAt: cycle ? new Date(cycle.cutoff).toISOString() : null,
      provisional: true,
    });
  }
  return { ok: true, value: options, requestId: query.requestId };
}
