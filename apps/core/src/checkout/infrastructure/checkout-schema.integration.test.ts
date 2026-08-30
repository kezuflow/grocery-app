import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

async function cols(table: string): Promise<string[]> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

describe("checkout/orders schema", () => {
  it("creates quote storage with unique idempotency and expiry metadata", async () => {
    expect(await cols("checkout_quote")).toEqual(
      expect.arrayContaining([
        "id",
        "attempt_id",
        "customer_id",
        "cart_id",
        "address_id",
        "delivery_cycle_id",
        "total_minor",
        "lines_json",
        "status",
        "version",
        "expires_at",
        "idempotency_key",
        "pre_service_fee_total_minor",
        "service_fee_configuration_id",
        "service_fee_snapshot_json",
      ]),
    );
    // Seed real referenced rows so FK enforcement is exercised.
    await env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES ('sc1','as1','active',1,1)",
    ).run();
    const offerId = (await env.DB.prepare("SELECT id FROM subscription_offer LIMIT 1").first<{
      id: string;
    }>())!.id;
    await env.DB.prepare(
      "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, created_at, updated_at) VALUES ('ss1','sc1',?,'TRIALING',1,99999999999999,1,1)",
    )
      .bind(offerId)
      .run();
    const addressId = "sad1";
    await env.DB.prepare(
      "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, status, version, created_at, updated_at) VALUES (?, 'sc1','Home','R','09', '{}', 10.3, 123.9, 'active', 1, 1, 1)",
    )
      .bind(addressId)
      .run();

    const cycleId = (await env.DB.prepare("SELECT id FROM delivery_cycle LIMIT 1").first<{
      id: string;
    }>())!.id;
    const insertQuote = (id: string, attemptId: string, key: string) =>
      env.DB.prepare(
        "INSERT INTO checkout_quote (id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, currency, subtotal_minor, total_minor, lines_json, status, version, expires_at, idempotency_key, created_at, updated_at) VALUES (?, ?, 'sc1', 'k1', ?, ?, 'PHP', 0, 0, '[]', 'ACTIVE', 1, 99999999999999, ?, 1, 1)",
      )
        .bind(id, attemptId, addressId, cycleId, key)
        .run();
    await insertQuote("q1", "a1", "ik1");
    await expect(insertQuote("q2", "a2", "ik1")).rejects.toThrow();
  });

  it("persists effective-dated global service fee configuration", async () => {
    expect(await cols("service_fee_configuration")).toEqual(
      expect.arrayContaining([
        "fee_type",
        "flat_minor",
        "percentage_basis_points",
        "currency",
        "effective_from",
        "effective_to",
        "version",
        "reason",
      ]),
    );
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM service_fee_configuration",
    ).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("creates one-order-per-payment-intent reaction identity", async () => {
    const columns = await cols("order_payment_reaction");
    expect(columns).toEqual(
      expect.arrayContaining(["payment_intent_id", "reaction_id", "order_id"]),
    );
  });

  it("creates immutable fulfillment snapshots and amendment structures", async () => {
    expect(await cols("order_fulfillment_snapshot")).toEqual(
      expect.arrayContaining([
        "order_id",
        "location_id",
        "cycle_id",
        "cutoff_at",
        "fulfillment_mode",
        "sourcing_modes_json",
      ]),
    );
    expect(await cols("paid_order_amendment")).toEqual(
      expect.arrayContaining(["id", "order_id", "status", "total_minor", "idempotency_key"]),
    );
    expect(await cols("paid_order_amendment_line")).toEqual(
      expect.arrayContaining([
        "amendment_id",
        "sku_id",
        "quantity",
        "base_quantity",
        "unit_price_minor",
      ]),
    );
  });

  it("creates durable finance exceptions with reconciliation metadata", async () => {
    expect(await cols("finance_exception")).toEqual(
      expect.arrayContaining([
        "kind",
        "payment_intent_id",
        "reaction_id",
        "attempts",
        "last_error_code",
        "status",
      ]),
    );
  });
});
