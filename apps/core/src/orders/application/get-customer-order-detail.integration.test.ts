import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getCustomerOrderDetail } from "./get-customer-order-detail";

async function seedOrder(options: { mode: "INSTANT" | "SCHEDULED"; withQuote: boolean }) {
  const suffix = crypto.randomUUID();
  const customerId = `customer-${suffix}`;
  const otherCustomerId = `other-${suffix}`;
  const orderId = `order-${suffix}`;
  const attemptId = `attempt-${suffix}`;
  const intentId = `intent-${suffix}`;
  const addressId = `address-${suffix}`;
  const cartId = `cart-${suffix}`;
  const quoteId = `quote-${suffix}`;
  const now = Date.now();
  const cycle = await env.DB.prepare(
    "SELECT id, cutoff_at, delivery_date FROM delivery_cycle WHERE status='OPEN' LIMIT 1",
  ).first<{ id: string; cutoff_at: number; delivery_date: number }>();
  if (!cycle) throw new Error("Expected seeded delivery cycle");
  const address = {
    label: "Home",
    recipient: "Ana Santos",
    phone: "+639171234567",
    address_json: JSON.stringify({
      addressLine1: "Ayala Center Cebu",
      addressLine2: null,
      barangay: "Luz",
      city: "Cebu City",
      region: "Central Visayas",
      postalCode: "6000",
      countryCode: "PH",
    }),
    delivery_instructions_json: JSON.stringify({ deliveryNote: "Call on arrival" }),
    latitude: 10.3173,
    longitude: 123.9058,
    assigned_staff_id: "must-not-leak",
    notes: "internal legacy note",
  };
  const addressJson = JSON.stringify(address);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(customerId, `auth-${customerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(otherCustomerId, `auth-${otherCustomerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, delivery_zone_code, delivery_instructions_json, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'Ana Santos', '+639171234567', ?, 10.3173, 123.9058, 'CEBU_CITY_CORE', ?, 'active', 1, ?, ?)",
    ).bind(
      addressId,
      customerId,
      address.address_json,
      address.delivery_instructions_json,
      now,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, 'location-cebu-central', 'CONVERTED', 1, ?, ?)",
    ).bind(cartId, customerId, now, now),
    env.DB.prepare(
      "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_quote', ?, ?, 28500, 'PHP', 'SUCCEEDED', ?, 1, ?, ?) ",
    ).bind(intentId, quoteId, customerId, `intent-key-${suffix}`, now + 10, now + 20),
    env.DB.prepare(
      "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 28500, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?, ?) ",
    ).bind(
      attemptId,
      customerId,
      intentId,
      `provider-secret-${suffix}`,
      `attempt-key-${suffix}`,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO grocery_order (
        id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status,
        total_minor, currency, payment_id, version, created_at,
        merchandise_subtotal_minor, item_discount_minor, order_discount_minor,
        delivery_subtotal_minor, delivery_discount_minor, service_fee_minor, tax_minor,
        order_number, committed_at
      ) VALUES (?, ?, ?, ?, ?, 'COMMITTED', 28500, 'PHP', ?, 2, ?, 30000, 0, 3000, 2000, 500, 0, 0, ?, ?)`,
    ).bind(
      orderId,
      customerId,
      options.mode === "SCHEDULED" ? cycle.id : null,
      options.mode,
      addressJson,
      attemptId,
      now,
      `FM-${suffix.slice(0, 8).toUpperCase()}`,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) VALUES (?, ?, 'sku-red-onion-500g', 'Red onion', '500 g', 'pack', 2, 15000, 30000, 1000)",
    ).bind(`item-${suffix}`, orderId),
    env.DB.prepare(
      "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at, fulfillment_mode, sourcing_modes_json, delivery_fee_snapshot_json, created_at) VALUES (?, 'location-cebu-central', ?, 'zone-cebu-city-core', ?, ?, ?, ?, '[\"STOCKED\"]', '{}', ?)",
    ).bind(
      orderId,
      options.mode === "SCHEDULED" ? cycle.id : null,
      options.mode === "SCHEDULED" ? cycle.cutoff_at : null,
      options.mode === "SCHEDULED" ? cycle.delivery_date : null,
      options.mode === "INSTANT" ? now + 3_600_000 : null,
      options.mode,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO fulfillment_record (id, order_id, location_id, status, updated_at, version) VALUES (?, ?, 'location-cebu-central', 'PICKING', ?, 2)",
    ).bind(`fulfillment-${suffix}`, orderId, now + 30),
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, promised_at, status, address_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'location-cebu-central', 'zone-cebu-city-core', ?, 'UNASSIGNED', ?, 1, ?, ?)",
    ).bind(
      `delivery-${suffix}`,
      orderId,
      options.mode === "SCHEDULED" ? cycle.id : null,
      options.mode,
      options.mode === "INSTANT" ? now + 3_600_000 : null,
      addressJson,
      now,
      now + 40,
    ),
    env.DB.prepare(
      "INSERT INTO order_issue (id, order_id, customer_id, category, status, details, assigned_staff_id, resolution, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'QUALITY', 'INVESTIGATING', 'Bruised produce', NULL, 'internal resolution note', 2, ?, ?, ?)",
    ).bind(`issue-${suffix}`, orderId, customerId, `issue-key-${suffix}`, now + 50, now + 60),
    env.DB.prepare(
      "INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, version, created_at, updated_at) VALUES (?, ?, 500, 'PHP', 'PROCESSING', 'internal refund reason', ?, 1, ?, ?)",
    ).bind(`refund-${suffix}`, intentId, `refund-key-${suffix}`, now + 70, now + 80),
  ]);

  if (options.withQuote) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO checkout_quote (
          id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id,
          fulfillment_mode, currency, subtotal_minor, discount_minor, delivery_fee_minor,
          total_minor, lines_json, address_snapshot_json, cycle_snapshot_json,
          fulfillment_snapshot_json, status, version, expires_at, idempotency_key,
          created_at, updated_at, delivery_fee_snapshot_json,
          merchandise_subtotal_minor, item_discount_minor, order_discount_minor,
          delivery_subtotal_minor, delivery_discount_minor, service_fee_minor, tax_minor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PHP', 30000, 3000, 1500, 28500, '[]', ?, '{}', '{}',
                  'CONSUMED', 2, ?, ?, ?, ?, '{}', 30000, 0, 3000, 2000, 500, 0, 0)`,
      ).bind(
        quoteId,
        `quote-attempt-${suffix}`,
        customerId,
        cartId,
        addressId,
        options.mode === "SCHEDULED" ? cycle.id : null,
        options.mode,
        addressJson,
        now + 60_000,
        `quote-key-${suffix}`,
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO order_payment_reaction (id, payment_intent_id, reaction_id, order_id, checkout_quote_id, applied_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(`order-reaction-${suffix}`, intentId, `reaction-${suffix}`, orderId, quoteId, now),
    ]);
  }

  return { customerId, otherCustomerId, orderId, mode: options.mode };
}

describe("getCustomerOrderDetail", () => {
  it("returns owned immutable snapshots, safe projections, actions, and a stable timeline", async () => {
    const fixture = await seedOrder({ mode: "SCHEDULED", withQuote: true });
    const result = await getCustomerOrderDetail(env.DB, {
      customerId: fixture.customerId,
      orderId: fixture.orderId,
      requestId: "detail-owned",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      orderId: fixture.orderId,
      status: "COMMITTED",
      financial: {
        source: "CHECKOUT_QUOTE",
        merchandiseSubtotalMinor: 30000,
        orderDiscountMinor: 3000,
        deliverySubtotalMinor: 2000,
        deliveryDiscountMinor: 500,
        deliveryFeeMinor: 1500,
        totalMinor: 28500,
      },
      fulfillment: {
        mode: "SCHEDULED",
        promisedAt: null,
        address: { label: "Home", city: "Cebu City", deliveryNote: "Call on arrival" },
      },
      payments: [{ status: "SUCCEEDED", amountMinor: 28500 }],
      refunds: [{ status: "PROCESSING", amountMinor: 500 }],
      issues: [{ category: "POOR_QUALITY", status: "IN_REVIEW", description: "Bruised produce" }],
      actions: expect.arrayContaining([
        {
          action: "CANCEL",
          available: false,
          disabledReason: "COMMITTED_ORDER_CANCELLATION_UNAVAILABLE",
        },
      ]),
    });
    expect(result.value.timeline.map((entry) => entry.occurredAt)).toEqual(
      result.value.timeline.map((entry) => entry.occurredAt).sort(),
    );
    expect(JSON.stringify(result.value)).not.toMatch(
      /provider-secret|assigned_staff|internal resolution|internal refund|latitude|longitude|location-cebu|zone-cebu|rider/i,
    );
  });

  it("returns NOT_FOUND for another customer and null components for legacy totals", async () => {
    const fixture = await seedOrder({ mode: "INSTANT", withQuote: false });
    const wrongOwner = await getCustomerOrderDetail(env.DB, {
      customerId: fixture.otherCustomerId,
      orderId: fixture.orderId,
      requestId: "detail-wrong-owner",
    });
    const historical = await getCustomerOrderDetail(env.DB, {
      customerId: fixture.customerId,
      orderId: fixture.orderId,
      requestId: "detail-historical",
    });

    expect(wrongOwner).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(historical).toMatchObject({
      ok: true,
      value: {
        financial: {
          source: "ORDER_TOTAL_ONLY",
          merchandiseSubtotalMinor: null,
          deliveryFeeMinor: null,
          totalMinor: 28500,
        },
        fulfillment: {
          mode: "INSTANT",
          cycleId: null,
          deliveryDate: null,
        },
      },
    });
    if (historical.ok) expect(historical.value.fulfillment.promisedAt).not.toBeNull();
  });
});
