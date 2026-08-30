import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { abandonCheckoutAttempt } from "./abandon-checkout-attempt";

async function fixture(mode: "INSTANT" | "SCHEDULED") {
  const suffix = crypto.randomUUID();
  const customerId = `abandon-customer-${suffix}`;
  const otherCustomerId = `abandon-other-${suffix}`;
  const cartId = `abandon-cart-${suffix}`;
  const addressId = `abandon-address-${suffix}`;
  const quoteId = `abandon-quote-${suffix}`;
  const now = Date.now();
  const cycleId = "cycle-next-cebu";
  const zoneId = "zone-cebu-city-core";
  const locationId = "location-cebu-central";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
    ).bind(customerId, `auth-${customerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
    ).bind(otherCustomerId, `auth-${otherCustomerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO customer_address (id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,?,'Home','Customer','09','{}',10.3,123.9,'active',1,?,?)",
    ).bind(addressId, customerId, now, now),
    env.DB.prepare(
      "INSERT INTO cart (id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,?,'ACTIVE',1,?,?)",
    ).bind(cartId, customerId, locationId, now, now),
    env.DB.prepare(
      `INSERT INTO checkout_quote
       (id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,
        subtotal_minor,total_minor,lines_json,status,version,expires_at,idempotency_key,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'PHP',100,100,'[]','ACTIVE',2,?,?,?,?)`,
    ).bind(
      quoteId,
      quoteId,
      customerId,
      cartId,
      addressId,
      mode === "SCHEDULED" ? cycleId : null,
      mode,
      now + 60000,
      `quote-key-${suffix}`,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO checkout_attempts
       (id,customer_id,cart_id,address_id,cycle_id,fulfillment_mode,zone_id,location_id,
        quote_version,status,idempotency_key,expires_at,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,2,'PROCESSING',?,?,1,?,?)`,
    ).bind(
      quoteId,
      customerId,
      cartId,
      addressId,
      mode === "SCHEDULED" ? cycleId : null,
      mode,
      zoneId,
      locationId,
      `attempt-key-${suffix}`,
      now + 60000,
      now,
      now,
    ),
  ]);
  if (mode === "INSTANT")
    await env.DB.prepare(
      "INSERT INTO checkout_inventory_holds (id,checkout_attempt_id,inventory_pool_id,location_id,quantity,status,created_at,updated_at) VALUES (?,?, 'pool-red-onion',?,500,'HELD',?,?)",
    )
      .bind(`hold-${suffix}`, quoteId, locationId, now, now)
      .run();
  else {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE cycle_zone_capacity SET allocated=allocated+1 WHERE cycle_id=? AND zone_id=? AND location_id=?",
      ).bind(cycleId, zoneId, locationId),
      env.DB.prepare(
        "INSERT INTO capacity_allocations (id,cycle_id,zone_id,location_id,checkout_attempt_id,units,status,created_at,updated_at) VALUES (?,?,?,?,?,1,'HELD',?,?)",
      ).bind(`capacity-${suffix}`, cycleId, zoneId, locationId, quoteId, now, now),
    ]);
  }
  return { customerId, otherCustomerId, quoteId };
}

function command(data: Awaited<ReturnType<typeof fixture>>) {
  return {
    customerId: data.customerId,
    quoteId: data.quoteId,
    expectedVersion: 2,
    idempotencyKey: `abandon-key-${crypto.randomUUID()}`,
    requestId: "abandon-request",
  };
}

describe("abandonCheckoutAttempt", () => {
  it.each(["INSTANT", "SCHEDULED"] as const)(
    "releases %s provisional resources once and creates no financial outcome",
    async (mode) => {
      const data = await fixture(mode);
      const input = command(data);
      const before = await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM grocery_order) orders,(SELECT COUNT(*) FROM payment_refund) refunds,(SELECT COUNT(*) FROM promotion_redemption) redemptions",
      ).first<{ orders: number; refunds: number; redemptions: number }>();
      const result = await abandonCheckoutAttempt(env.DB, input);
      const replay = await abandonCheckoutAttempt(env.DB, input);
      const after = await env.DB.prepare(
        `SELECT q.status quoteStatus,a.status attemptStatus,
          (SELECT COUNT(*) FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='RELEASED') releasedHolds,
          (SELECT COUNT(*) FROM capacity_allocations WHERE checkout_attempt_id=? AND status='RELEASED') releasedCapacity,
          (SELECT COUNT(*) FROM grocery_order) orders,(SELECT COUNT(*) FROM payment_refund) refunds,
          (SELECT COUNT(*) FROM promotion_redemption) redemptions
         FROM checkout_quote q JOIN checkout_attempts a ON a.id=q.attempt_id WHERE q.id=?`,
      )
        .bind(data.quoteId, data.quoteId, data.quoteId)
        .first<Record<string, number | string>>();
      expect(result).toMatchObject({
        ok: true,
        value: {
          outcome: "ABANDONED",
          releasedInventoryHolds: mode === "INSTANT" ? 1 : 0,
          releasedCapacityAllocations: mode === "SCHEDULED" ? 1 : 0,
        },
      });
      expect(replay).toEqual(result);
      expect(after).toMatchObject({
        quoteStatus: "SUPERSEDED",
        attemptStatus: "EXPIRED",
        orders: before?.orders,
        refunds: before?.refunds,
        redemptions: before?.redemptions,
      });
    },
  );

  it("conceals ownership and rejects stale or changed replay commands", async () => {
    const data = await fixture("INSTANT");
    const input = command(data);
    const hidden = await abandonCheckoutAttempt(env.DB, {
      ...input,
      customerId: data.otherCustomerId,
    });
    const stale = await abandonCheckoutAttempt(env.DB, { ...input, expectedVersion: 1 });
    const success = await abandonCheckoutAttempt(env.DB, input);
    const conflict = await abandonCheckoutAttempt(env.DB, { ...input, expectedVersion: 3 });
    expect(hidden).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    expect(success.ok).toBe(true);
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("fails closed once payment can still resolve successfully", async () => {
    const data = await fixture("INSTANT");
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO payment_intent (id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP','PROCESSING',?,1,?,?)",
    )
      .bind(
        `payment-${data.quoteId}`,
        data.quoteId,
        data.customerId,
        `payment-key-${data.quoteId}`,
        now,
        now,
      )
      .run();
    const result = await abandonCheckoutAttempt(env.DB, command(data));
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
        .bind(data.quoteId)
        .first(),
    ).toEqual({ status: "ACTIVE" });
  });

  it("returns a safe no-op for an already expired quote", async () => {
    const data = await fixture("INSTANT");
    await env.DB.prepare("UPDATE checkout_quote SET status='EXPIRED' WHERE id=?")
      .bind(data.quoteId)
      .run();
    const result = await abandonCheckoutAttempt(env.DB, command(data));
    expect(result).toMatchObject({
      ok: true,
      value: { outcome: "ALREADY_TERMINAL", quoteStatus: "EXPIRED" },
    });
  });
});
