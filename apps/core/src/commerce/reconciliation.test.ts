import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { expireCheckoutAttempts } from "./reconciliation";

describe("checkout reconciliation", () => {
  it("expires an attempt and releases capacity, stock, and idempotency state", async () => {
    const now = Date.now();
    const customerId = crypto.randomUUID();
    const cartId = crypto.randomUUID();
    const addressId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const allocationId = crypto.randomUUID();
    const holdId = crypto.randomUUID();
    const key = `reconcile-${crypto.randomUUID()}`;
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
        "INSERT INTO checkout_attempts (id, customer_id, cart_id, address_id, cycle_id, zone_id, location_id, status, idempotency_key, expires_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'cycle-next-cebu', 'zone-cebu-city-core', 'location-cebu-central', 'PROCESSING', ?, ?, 1, ?, ?)",
      ).bind(attemptId, customerId, cartId, addressId, key, now - 1, now, now),
      env.DB.prepare(
        "INSERT INTO cycle_zone_capacity (cycle_id, zone_id, location_id, capacity, allocated, version) VALUES ('cycle-next-cebu', 'zone-cebu-city-core', 'location-cebu-central', 10, 1, 1) ON CONFLICT(cycle_id, zone_id, location_id) DO UPDATE SET allocated=1",
      ),
      env.DB.prepare(
        "INSERT INTO capacity_allocations (id, cycle_id, zone_id, location_id, checkout_attempt_id, units, status, created_at, updated_at) VALUES (?, 'cycle-next-cebu', 'zone-cebu-city-core', 'location-cebu-central', ?, 1, 'HELD', ?, ?)",
      ).bind(allocationId, attemptId, now, now),
      env.DB.prepare(
        "INSERT INTO checkout_inventory_holds (id, checkout_attempt_id, inventory_pool_id, location_id, quantity, status, created_at, updated_at) VALUES (?, ?, 'pool-red-onion', 'location-cebu-central', 500, 'HELD', ?, ?)",
      ).bind(holdId, attemptId, now, now),
      env.DB.prepare(
        "UPDATE inventory_balance SET reserved=500 WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'",
      ),
      env.DB.prepare(
        "INSERT INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES ('checkout.quote', ?, 'hash', 'grocery_order', 'PROCESSING', ?, ?)",
      ).bind(key, now, now),
    ]);

    await expect(expireCheckoutAttempts(env.DB, now)).resolves.toBe(1);
    await expect(
      env.DB.prepare("SELECT status FROM checkout_attempts WHERE id=?").bind(attemptId).first(),
    ).resolves.toMatchObject({ status: "EXPIRED" });
    await expect(
      env.DB.prepare("SELECT status FROM capacity_allocations WHERE id=?")
        .bind(allocationId)
        .first(),
    ).resolves.toMatchObject({ status: "EXPIRED" });
    await expect(
      env.DB.prepare("SELECT status FROM checkout_inventory_holds WHERE id=?").bind(holdId).first(),
    ).resolves.toMatchObject({ status: "EXPIRED" });
    await expect(
      env.DB.prepare(
        "SELECT reserved FROM inventory_balance WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'",
      ).first(),
    ).resolves.toMatchObject({ reserved: 0 });
    await expect(
      env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(key)
        .first(),
    ).resolves.toMatchObject({ status: "FAILED" });
    await expect(expireCheckoutAttempts(env.DB, now + 1)).resolves.toBe(0);
  });
});
