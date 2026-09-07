import type { CheckoutEligibilityRequest } from "@freshmarkets/contracts";
import { drizzle } from "drizzle-orm/d1";
import { resolveServiceability } from "../../geography/serviceability";
import { defaultCurrency } from "../../geography/market-defaults";
import { checkoutEligibility } from "../../commerce/service";
import { resolveCheckoutDecision } from "./resolve-checkout-decision";
import { closestLocation } from "../../geography/geometry";

export type CheckoutEvaluation = {
  eligible: boolean;
  failures: string[];
  totalMinor: number;
  currency: string;
};

/**
 * Central checkout eligibility orchestration for a Scheduled cycle: resolves
 * address ownership/serviceability, zone routing,
 * live cart total under the authoritative price context and zone fee. Core
 * repeats this validation at quote and commitment; the browser
 * result here is advisory.
 */
export async function evaluateCheckout(
  database: D1Database,
  command: CheckoutEligibilityRequest & { customerId: string },
): Promise<{ ok: true; value: CheckoutEvaluation; requestId: string }> {
  const db = drizzle(database);
  const now = Date.now();
  const [address, cycle, policy] = await Promise.all([
    database
      .prepare(
        "SELECT latitude, longitude, delivery_zone_code FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
      )
      .bind(command.addressId, command.customerId)
      .first<{ latitude: number; longitude: number; delivery_zone_code: string | null }>(),
    database
      .prepare("SELECT id, market_id, status, cutoff_at FROM delivery_cycle WHERE id=?")
      .bind(command.cycleId)
      .first<{
        id: string;
        market_id: string;
        status: string;
        cutoff_at: number;
      }>(),
    database
      .prepare(
        "SELECT mcp.minimum_basket_minor, mcp.currency FROM delivery_cycle dc JOIN market_commerce_policy mcp ON mcp.market_id=dc.market_id WHERE dc.id=?",
      )
      .bind(command.cycleId)
      .first<{ minimum_basket_minor: number; currency: string }>(),
  ]);
  const routingCandidates = address?.delivery_zone_code
    ? await database
        .prepare(
          `SELECT dz.id zone_id,fl.id,fl.id location_id,fl.latitude,fl.longitude
             FROM delivery_zone dz
             JOIN service_area sa ON sa.id=dz.service_area_id
             JOIN delivery_cycle dc ON dc.market_id=sa.market_id
             JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1
             JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.market_id=dc.market_id AND fl.status='active'
             JOIN delivery_cycle_zone dcz ON dcz.cycle_id=dc.id AND dcz.zone_id=dz.id
               AND dcz.location_id=fl.id AND dcz.status='ACTIVE'
             JOIN global_commerce_configuration mode ON mode.id='global'
              AND mode.selling_state='OPEN' AND mode.fulfillment_mode='SCHEDULED'
            WHERE dz.code=? AND dz.status='active' AND dc.id=?
            ORDER BY fl.id`,
        )
        .bind(address.delivery_zone_code, command.cycleId)
        .all<{
          id: string;
          zone_id: string;
          location_id: string;
          latitude: number;
          longitude: number;
        }>()
    : { results: [] };
  const routing = address ? closestLocation(address, routingCandidates.results) : null;
  const [cart, fee, unavailableItem] = await Promise.all([
    database
      .prepare(
        "SELECT c.id, COALESCE(SUM(ci.quantity * (SELECT amount_minor FROM price_version pv JOIN delivery_cycle dc ON dc.id=? WHERE pv.sku_id=ci.sku_id AND pv.market_id=dc.market_id AND pv.currency=? AND pv.price_type='STANDARD' AND pv.location_id=? AND pv.amount_minor>0 AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY pv.version DESC LIMIT 1)),0) AS total_minor FROM cart c LEFT JOIN cart_item ci ON ci.cart_id=c.id WHERE c.id=? AND c.customer_id=? AND c.status='ACTIVE' GROUP BY c.id",
      )
      .bind(
        command.cycleId,
        policy?.currency ?? "",
        routing?.location_id ?? null,
        now,
        now,
        command.cartId,
        command.customerId,
      )
      .first<{ id: string; total_minor: number }>(),
    routing
      ? database
          .prepare(
            "SELECT fee_minor, currency FROM delivery_zone_fee WHERE zone_id=? AND location_id=? AND status='active'",
          )
          .bind(routing.zone_id, routing.location_id)
          .first<{ fee_minor: number; currency: string }>()
      : null,
    routing
      ? database
          .prepare(
            `SELECT 1 found FROM cart_item ci
             JOIN sku s ON s.id=ci.sku_id
             JOIN product p ON p.id=s.product_id
             LEFT JOIN sku_location_availability availability
               ON availability.sku_id=s.id AND availability.location_id=?
             WHERE ci.cart_id=? AND (
               s.status<>'active' OR p.status<>'active'
               OR availability.availability_status IS NULL
               OR availability.availability_status<>'AVAILABLE'
               OR NOT EXISTS (
                 SELECT 1 FROM price_version pv JOIN delivery_cycle dc ON dc.id=?
                 WHERE pv.sku_id=s.id AND pv.market_id=dc.market_id AND pv.currency=?
                   AND pv.location_id=? AND pv.price_type='STANDARD' AND pv.amount_minor>0
                   AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?)
               )
             ) LIMIT 1`,
          )
          .bind(
            routing.location_id,
            command.cartId,
            command.cycleId,
            policy?.currency ?? "",
            routing.location_id,
            now,
            now,
          )
          .first()
      : null,
  ]);
  const geo = address
    ? await resolveServiceability(db, {
        requestId: command.requestId,
        latitude: address.latitude,
        longitude: address.longitude,
      })
    : null;
  const eligibility = checkoutEligibility(
    {
      requestId: command.requestId,
      latitude: address?.latitude ?? 0,
      longitude: address?.longitude ?? 0,
      customerId: command.customerId,
    },
    Boolean(geo?.ok && geo.value.serviceable),
  );
  const failures = [...eligibility.failures];
  if (!address) failures.push("ADDRESS_REQUIRED");
  if (address && !routing) failures.push("ADDRESS_NOT_SERVICEABLE");
  if (!cycle || cycle.status !== "OPEN" || cycle.cutoff_at <= now) failures.push("CYCLE_CLOSED");
  if (unavailableItem) failures.push("CATALOG_UNAVAILABLE");
  if (routing && !fee) failures.push("CONFIGURATION_ERROR");
  const financial = {
    merchandiseSubtotalMinor: cart?.total_minor ?? 0,
    itemDiscountMinor: 0,
    orderDiscountMinor: 0,
    deliverySubtotalMinor: fee?.fee_minor ?? 0,
    deliveryDiscountMinor: 0,
    serviceFeeMinor: 0,
    taxMinor: 0,
    totalMinor: (cart?.total_minor ?? 0) + (fee?.fee_minor ?? 0),
    currency: fee?.currency ?? policy?.currency ?? "",
  };
  const decision = cycle
    ? await resolveCheckoutDecision(database, {
        marketId: cycle.market_id,
        financial,
        evidence: { fulfillmentMode: "SCHEDULED" as const },
      })
    : null;
  for (const decisionFailure of decision?.failures ?? ["CONFIGURATION_ERROR" as const]) {
    if (!failures.includes(decisionFailure)) failures.push(decisionFailure);
  }
  if (!cart && !failures.includes("MINIMUM_ORDER_NOT_MET")) failures.push("MINIMUM_ORDER_NOT_MET");
  const totalMinor = (cart?.total_minor ?? 0) + (fee?.fee_minor ?? 0);
  return {
    ok: true as const,
    value: {
      eligible: failures.length === 0,
      failures,
      totalMinor,
      currency:
        decision?.currency ||
        policy?.currency ||
        fee?.currency ||
        (await defaultCurrency(database)) ||
        "",
    },
    requestId: command.requestId,
  };
}
