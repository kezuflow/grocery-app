import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createCheckoutRepository } from "./d1-checkout-repository";

type TableInfoRow = { name: string; notnull: number; dflt_value: string | null };

async function tableColumns(table: string): Promise<Map<string, TableInfoRow>> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<TableInfoRow>();
  return new Map(rows.results.map((row) => [row.name, row]));
}

describe("financial safety migration", () => {
  it.each(["checkout_quote", "grocery_order"])(
    "adds explicit financial components to %s",
    async (table) => {
      const columns = await tableColumns(table);

      for (const column of [
        "merchandise_subtotal_minor",
        "item_discount_minor",
        "order_discount_minor",
        "delivery_subtotal_minor",
        "delivery_discount_minor",
        "service_fee_minor",
        "tax_minor",
      ]) {
        expect(columns.get(column), `${table}.${column}`).toMatchObject({ notnull: 1 });
      }
    },
  );

  it("persists only well-formed resumable provider actions", async () => {
    const columns = await tableColumns("payment_provider_action");
    expect([...columns.keys()]).toEqual(
      expect.arrayContaining([
        "payment_intent_id",
        "authorization_id",
        "provider",
        "provider_reference",
        "action_type",
        "redirect_url",
        "client_token",
        "expires_at",
        "status",
      ]),
    );

    const schema = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_provider_action'",
    ).first<{ sql: string }>();
    expect(schema?.sql).toContain("action_type IN ('REDIRECT','SDK')");
    expect(schema?.sql).toContain("payment_intent_id IS NOT NULL");
    expect(schema?.sql).toContain("authorization_id IS NOT NULL");
  });

  it("enforces one committed order per checkout quote", async () => {
    const columns = await tableColumns("order_payment_reaction");
    expect(columns.has("checkout_quote_id")).toBe(true);

    const indexes = await env.DB.prepare("PRAGMA index_list(order_payment_reaction)").all<{
      name: string;
      unique: number;
    }>();
    expect(indexes.results).toContainEqual(
      expect.objectContaining({ name: "order_payment_reaction_quote_unique", unique: 1 }),
    );
  });

  it("round-trips every canonical quote component", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `customer-financial-${suffix}`;
    const addressId = `address-financial-${suffix}`;
    const quoteId = `quote-financial-${suffix}`;
    const now = Date.now();
    const cycle = await env.DB.prepare(
      "SELECT id FROM delivery_cycle ORDER BY delivery_date LIMIT 1",
    ).first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'Customer', '09', '{}', 10.3, 123.9, 'active', 1, ?, ?)",
      ).bind(addressId, customerId, now, now),
    ]);
    await env.DB.prepare(
      `INSERT INTO checkout_quote (
        id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id,
        fulfillment_mode, currency, subtotal_minor, discount_minor,
        delivery_fee_minor, total_minor, merchandise_subtotal_minor,
        item_discount_minor, order_discount_minor, delivery_subtotal_minor,
        delivery_discount_minor, service_fee_minor, tax_minor, lines_json,
        status, version, expires_at, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', 'PHP', 20000, 1000, 2000,
        20700, 20000, 500, 1000, 2000, 500, 200, 0, '[]', 'ACTIVE', 1,
        ?, ?, ?, ?)`,
    )
      .bind(
        quoteId,
        quoteId,
        customerId,
        `cart-${suffix}`,
        addressId,
        cycle!.id,
        now + 60_000,
        `key-${suffix}`,
        now,
        now,
      )
      .run();

    const quote = await createCheckoutRepository(env.DB).findQuoteById(quoteId);

    expect(quote).toMatchObject({
      financial: {
        merchandiseSubtotalMinor: 20_000,
        itemDiscountMinor: 500,
        orderDiscountMinor: 1_000,
        deliverySubtotalMinor: 2_000,
        deliveryDiscountMinor: 500,
        serviceFeeMinor: 200,
        taxMinor: 0,
        totalMinor: 20_700,
        currency: "PHP",
      },
    });
  });
});
