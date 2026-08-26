import type { CheckoutEligibilityRequest } from "@freshmarkets/contracts";
import { drizzle } from "drizzle-orm/d1";
import { resolveServiceability } from "../../geography/serviceability";
import { defaultCurrency } from "../../geography/market-defaults";
import { checkoutEligibility } from "../../commerce/service";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type CheckoutEvaluation = {
  eligible: boolean;
  failures: string[];
  totalMinor: number;
  currency: string;
};

/**
 * Central checkout eligibility orchestration for a Scheduled cycle: resolves
 * subscription entitlement, address ownership/serviceability, zone routing,
 * live cart total under the authoritative price context, zone fee, and
 * capacity. Core repeats this validation at quote and commitment; the browser
 * result here is advisory.
 */
export async function evaluateCheckout(
  database: D1Database,
  command: CheckoutEligibilityRequest & { customerId: string },
): Promise<
  { ok: true; value: CheckoutEvaluation; requestId: string } | ReturnType<typeof failure>
> {
  const db = drizzle(database);
  const now = Date.now();
  const [subscription, address, cycle, policy] = await Promise.all([
    database
      .prepare(
        "SELECT status, trial_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
      )
      .bind(command.customerId)
      .first<{ status: string; trial_ends_at: number | null }>(),
    database
      .prepare(
        "SELECT latitude, longitude, delivery_zone_code FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
      )
      .bind(command.addressId, command.customerId)
      .first<{ latitude: number; longitude: number; delivery_zone_code: string | null }>(),
    database
      .prepare("SELECT id, status, cutoff_at, capacity, allocated FROM delivery_cycle WHERE id=?")
      .bind(command.cycleId)
      .first<{
        id: string;
        status: string;
        cutoff_at: number;
        capacity: number;
        allocated: number;
      }>(),
    database
      .prepare(
        "SELECT mcp.minimum_basket_minor, mcp.currency FROM delivery_cycle dc JOIN market_commerce_policy mcp ON mcp.market_id=dc.market_id WHERE dc.id=?",
      )
      .bind(command.cycleId)
      .first<{ minimum_basket_minor: number; currency: string }>(),
  ]);
  const routing = address?.delivery_zone_code
    ? await database
        .prepare(
          "SELECT dz.id zone_id, ls.location_id FROM delivery_zone dz JOIN service_area sa ON sa.id=dz.service_area_id JOIN delivery_cycle dc ON dc.market_id=sa.market_id JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1 JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.market_id=dc.market_id AND fl.status='active' WHERE dz.code=? AND dz.status='active' AND dc.id=? ORDER BY ls.priority LIMIT 1",
        )
        .bind(address.delivery_zone_code, command.cycleId)
        .first<{ zone_id: string; location_id: string }>()
    : null;
  const [cart, fee, zoneCapacity] = await Promise.all([
    database
      .prepare(
        "SELECT c.id, COALESCE(SUM(ci.quantity * COALESCE((SELECT amount_minor FROM price_version pv JOIN delivery_cycle dc ON dc.id=? WHERE pv.sku_id=ci.sku_id AND pv.market_id=dc.market_id AND pv.currency=? AND pv.price_type='STANDARD' AND (pv.location_id IS NULL OR pv.location_id=?) AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY (pv.location_id IS NOT NULL) DESC, pv.version DESC LIMIT 1),0)),0) AS total_minor FROM cart c LEFT JOIN cart_item ci ON ci.cart_id=c.id WHERE c.id=? AND c.customer_id=? AND c.status='ACTIVE' GROUP BY c.id",
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
            "SELECT capacity-allocated AS remaining FROM cycle_zone_capacity WHERE cycle_id=? AND zone_id=? AND location_id=?",
          )
          .bind(command.cycleId, routing.zone_id, routing.location_id)
          .first<{ remaining: number }>()
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
      hasEligibleSubscription: Boolean(
        subscription &&
        ["ACTIVE", "TRIALING"].includes(subscription.status) &&
        (!subscription.trial_ends_at || subscription.trial_ends_at > now),
      ),
    },
    Boolean(geo?.ok && geo.value.serviceable),
  );
  const failures = [...eligibility.failures];
  if (!address) failures.push("ADDRESS_REQUIRED");
  if (address && !routing) failures.push("ADDRESS_NOT_SERVICEABLE");
  if (!cycle || cycle.status !== "OPEN" || cycle.cutoff_at <= now) failures.push("CYCLE_CLOSED");
  if (zoneCapacity?.remaining !== null && zoneCapacity?.remaining !== undefined) {
    if (zoneCapacity.remaining <= 0) failures.push("CYCLE_FULL");
  } else if (cycle && cycle.allocated >= cycle.capacity) failures.push("CYCLE_FULL");
  if (!policy) failures.push("CONFIGURATION_ERROR");
  if (routing && !fee) failures.push("CONFIGURATION_ERROR");
  if (policy && fee && policy.currency !== fee.currency) failures.push("CONFIGURATION_ERROR");
  if (cart && policy && cart.total_minor < policy.minimum_basket_minor)
    failures.push("MINIMUM_ORDER_NOT_MET");
  if (!cart) failures.push("MINIMUM_ORDER_NOT_MET");
  const totalMinor = (cart?.total_minor ?? 0) + (fee?.fee_minor ?? 0);
  return {
    ok: true as const,
    value: {
      eligible: failures.length === 0,
      failures,
      totalMinor,
      currency: policy?.currency ?? fee?.currency ?? (await defaultCurrency(database)) ?? "",
    },
    requestId: command.requestId,
  };
}
