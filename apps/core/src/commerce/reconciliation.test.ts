import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { expireCheckoutAttempts } from "./reconciliation";

async function seedInstantAttempt(now: number) {
  const customerId = crypto.randomUUID();
  const cartId = crypto.randomUUID();
  const addressId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const holdId = crypto.randomUUID();
  const key = `expire-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(customerId, `auth-${customerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, 'location-cebu-central', 'ACTIVE', 1, ?, ?)",
    ).bind(cartId, customerId, now, now),
    env.DB.prepare(
      "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, delivery_zone_code, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'Test', '09000000000', '{}', 10.32, 123.90, 'CEBU_CITY_CORE', 'active', 1, ?, ?)",
    ).bind(addressId, customerId, now, now),
    env.DB.prepare(
      "INSERT INTO checkout_attempts (id, customer_id, cart_id, address_id, cycle_id, fulfillment_mode, zone_id, location_id, status, idempotency_key, expires_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'INSTANT', 'zone-cebu-city-core', 'location-cebu-central', 'PROCESSING', ?, ?, 1, ?, ?)",
    ).bind(attemptId, customerId, cartId, addressId, `${key}:instant`, now - 1, now, now),
    env.DB.prepare(
      "INSERT INTO checkout_quote (id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, fulfillment_mode, currency, subtotal_minor, total_minor, lines_json, status, version, expires_at, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 'INSTANT', 'PHP', 100, 100, '[]', 'ACTIVE', 1, ?, ?, ?, ?)",
    ).bind(attemptId, attemptId, customerId, cartId, addressId, now - 1, key, now, now),
    env.DB.prepare(
      "INSERT INTO checkout_inventory_holds (id, checkout_attempt_id, inventory_pool_id, location_id, quantity, status, created_at, updated_at) VALUES (?, ?, 'pool-red-onion', 'location-cebu-central', 500, 'HELD', ?, ?)",
    ).bind(holdId, attemptId, now, now),
  ]);
  return { attemptId, holdId, customerId };
}

describe("checkout reconciliation", () => {
  it("expires an unpaid Instant hold without reducing another Order's reservation", async () => {
    const now = Date.now();
    const { attemptId, holdId } = await seedInstantAttempt(now);
    await env.DB.prepare(
      "UPDATE inventory_balance SET reserved=500 WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'",
    ).run();

    await expect(expireCheckoutAttempts(env.DB, now)).resolves.toBe(1);
    await expect(
      env.DB.prepare("SELECT status FROM checkout_attempts WHERE id=?").bind(attemptId).first(),
    ).resolves.toMatchObject({ status: "EXPIRED" });
    await expect(
      env.DB.prepare("SELECT status FROM checkout_inventory_holds WHERE id=?").bind(holdId).first(),
    ).resolves.toMatchObject({ status: "RELEASED" });
    await expect(
      env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?").bind(attemptId).first(),
    ).resolves.toMatchObject({ status: "SUPERSEDED" });
    await expect(
      env.DB.prepare(
        "SELECT reserved FROM inventory_balance WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'",
      ).first(),
    ).resolves.toMatchObject({ reserved: 500 });
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) count FROM inventory_ledger_entries WHERE reference_type='checkout_attempt' AND reference_id=?",
      )
        .bind(`checkout_attempt:${attemptId}`)
        .first(),
    ).resolves.toMatchObject({ count: 0 });
    await expect(expireCheckoutAttempts(env.DB, now + 1)).resolves.toBe(0);
  });

  it("preserves a due hold while payment is unresolved, then expires it after definitive failure", async () => {
    const now = Date.now();
    const { attemptId, holdId, customerId } = await seedInstantAttempt(now);
    await env.DB.prepare(
      "INSERT INTO payment_intent (id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP','PROCESSING',?,1,?,?)",
    )
      .bind(crypto.randomUUID(), attemptId, customerId, `pay-${attemptId}`, now, now)
      .run();

    await expect(expireCheckoutAttempts(env.DB, now)).resolves.toBe(0);
    await expect(
      env.DB.prepare("SELECT status FROM checkout_inventory_holds WHERE id=?").bind(holdId).first(),
    ).resolves.toMatchObject({ status: "HELD" });
    await env.DB.prepare("UPDATE payment_intent SET status='FAILED' WHERE subject_id=?")
      .bind(attemptId)
      .run();
    await expect(expireCheckoutAttempts(env.DB, now + 1)).resolves.toBe(1);
  });

  it("releases retained Scheduled capacity by its recorded units", async () => {
    const now = Date.now();
    const { attemptId, holdId } = await seedInstantAttempt(now);
    const allocationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE checkout_attempts SET fulfillment_mode='SCHEDULED',cycle_id='cycle-next-cebu' WHERE id=?",
      ).bind(attemptId),
      env.DB.prepare(
        "UPDATE checkout_quote SET fulfillment_mode='SCHEDULED',delivery_cycle_id='cycle-next-cebu' WHERE id=?",
      ).bind(attemptId),
      env.DB.prepare(
        "INSERT INTO cycle_zone_capacity (cycle_id, zone_id, location_id, capacity, allocated, version) VALUES ('cycle-next-cebu', 'zone-cebu-city-core', 'location-cebu-central', 10, 2, 1) ON CONFLICT(cycle_id, zone_id, location_id) DO UPDATE SET allocated=2",
      ),
      env.DB.prepare(
        "INSERT INTO capacity_allocations (id, cycle_id, zone_id, location_id, checkout_attempt_id, units, status, created_at, updated_at) VALUES (?, 'cycle-next-cebu', 'zone-cebu-city-core', 'location-cebu-central', ?, 2, 'HELD', ?, ?)",
      ).bind(allocationId, attemptId, now, now),
    ]);

    await expect(expireCheckoutAttempts(env.DB, now)).resolves.toBe(1);
    await expect(
      env.DB.prepare(
        "SELECT allocated FROM cycle_zone_capacity WHERE cycle_id='cycle-next-cebu'",
      ).first(),
    ).resolves.toMatchObject({ allocated: 0 });
    await expect(
      env.DB.prepare("SELECT status FROM capacity_allocations WHERE id=?")
        .bind(allocationId)
        .first(),
    ).resolves.toMatchObject({ status: "RELEASED" });
    await expect(
      env.DB.prepare("SELECT status FROM checkout_inventory_holds WHERE id=?").bind(holdId).first(),
    ).resolves.toMatchObject({ status: "RELEASED" });
  });
});
