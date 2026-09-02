import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getCart, setCartItem } from "../../checkout/application/cart";
import { reorderOrder } from "./reorder-order";

async function customer() {
  const suffix = crypto.randomUUID();
  const customerId = `reorder-customer-${suffix}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${suffix}`, now, now)
    .run();
  return customerId;
}

async function sku(options: {
  skuActive?: boolean;
  productActive?: boolean;
  available?: boolean;
  priced?: boolean;
}) {
  const suffix = crypto.randomUUID();
  const poolId = `reorder-pool-${suffix}`;
  const productId = `reorder-product-${suffix}`;
  const skuId = `reorder-sku-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, canonical_sourcing_mode, created_at, updated_at) VALUES (?, ?, 'unit-gram', 'STOCKED', 'STOCKED', 1, 1)",
    ).bind(poolId, productId),
    env.DB.prepare(
      "INSERT INTO product (id, category_id, inventory_pool_id, slug, name, status, created_at, updated_at) VALUES (?, (SELECT id FROM category LIMIT 1), ?, ?, ?, ?, 1, 1)",
    ).bind(
      productId,
      poolId,
      `reorder-${suffix}`,
      `Reorder product ${suffix}`,
      options.productActive === false ? "inactive" : "active",
    ),
    env.DB.prepare(
      "INSERT INTO sku (id, product_id, code, name, sellable_unit_id, consumption_base_quantity, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 'unit-gram', 500, ?, 1, 1, 1)",
    ).bind(
      skuId,
      productId,
      `REORDER_${suffix}`,
      `Reorder SKU ${suffix}`,
      options.skuActive === false ? "inactive" : "active",
    ),
    env.DB.prepare(
      "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (?, 'location-cebu-central', ?, 'STOCKED', 1)",
    ).bind(skuId, options.available === false ? "UNAVAILABLE" : "AVAILABLE"),
  ]);
  if (options.priced !== false)
    await env.DB.prepare(
      "INSERT INTO price_version (id, sku_id, market_id, location_id, currency, amount_minor, price_type, valid_from, version, created_at) VALUES (?, ?, 'market-metro-cebu', 'location-cebu-central', 'PHP', 7777, 'STANDARD', 0, 1, 1)",
    )
      .bind(`reorder-price-${suffix}`, skuId)
      .run();
  return skuId;
}

async function order(
  customerId: string,
  lines: readonly { skuId: string; quantity: number; name: string }[],
) {
  const suffix = crypto.randomUUID();
  const orderId = `reorder-order-${suffix}`;
  const paymentId = `reorder-attempt-${suffix}`;
  const now = Date.now();
  const cycle = await env.DB.prepare("SELECT id FROM delivery_cycle LIMIT 1").first<{
    id: string;
  }>();
  if (!cycle) throw new Error("Expected delivery cycle");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 10000, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?)",
    ).bind(paymentId, customerId, `reorder-payment-${suffix}`, now, now),
    env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, version, created_at, order_number, committed_at) VALUES (?, ?, ?, 'SCHEDULED', '{}', 'COMMITTED', 10000, 'PHP', ?, 1, ?, ?, ?)",
    ).bind(orderId, customerId, cycle.id, paymentId, now, `FM-REORDER-${suffix.slice(0, 8)}`, now),
    ...lines.map((line, index) =>
      env.DB.prepare(
        "INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) VALUES (?, ?, ?, ?, 'Historical variant', 'pack', ?, 99999, 99999, 500)",
      ).bind(`reorder-item-${suffix}-${index}`, orderId, line.skuId, line.name, line.quantity),
    ),
  ]);
  return orderId;
}

describe("reorderOrder", () => {
  it("merges current eligible items, returns every controlled skip, and replays without restoring history", async () => {
    const customerId = await customer();
    const otherCustomerId = await customer();
    const inactiveSku = await sku({ skuActive: false });
    const inactiveProductSku = await sku({ productActive: false });
    const unavailableSku = await sku({ available: false });
    const unpricedSku = await sku({ priced: false });
    const invalidQuantitySku = await sku({});
    const orderId = await order(customerId, [
      { skuId: "sku-red-onion-500g", quantity: 2, name: "Historical onion" },
      { skuId: inactiveSku, quantity: 1, name: "Inactive SKU" },
      { skuId: inactiveProductSku, quantity: 1, name: "Inactive product" },
      { skuId: unavailableSku, quantity: 1, name: "Unavailable here" },
      { skuId: unpricedSku, quantity: 1, name: "No current price" },
      { skuId: invalidQuantitySku, quantity: 0, name: "Invalid historical line" },
    ]);
    const cart = await getCart(env.DB, { customerId, requestId: "reorder-cart", headers: {} });
    if (!cart.ok) throw new Error("cart setup failed");
    const seeded = await setCartItem(env.DB, {
      customerId,
      requestId: "seed-cart",
      headers: {},
      cartId: cart.value.id,
      skuId: "sku-red-onion-500g",
      quantity: 1,
      expectedVersion: cart.value.version,
      idempotencyKey: `seed-cart-${crypto.randomUUID()}`,
    });
    if (!seeded.ok) throw new Error("cart seed failed");
    const command = {
      customerId,
      orderId,
      expectedCartVersion: seeded.value.version,
      idempotencyKey: `reorder-${crypto.randomUUID()}`,
      requestId: "reorder-request",
      headers: {},
    };

    const result = await reorderOrder(env.DB, command);
    const replay = await reorderOrder(env.DB, command);
    const wrongOwner = await reorderOrder(env.DB, { ...command, customerId: otherCustomerId });

    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: "PARTIAL",
        addedLines: [{ skuId: "sku-red-onion-500g", quantityAdded: 2, newQuantity: 3 }],
        requiresFulfillmentReview: true,
        requiresAddressReview: true,
      },
    });
    if (result.ok) {
      expect(result.value.skippedLines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ skuId: inactiveSku, reason: "SKU_INACTIVE" }),
          expect.objectContaining({ skuId: inactiveProductSku, reason: "PRODUCT_INACTIVE" }),
          expect.objectContaining({ skuId: unavailableSku, reason: "LOCATION_UNAVAILABLE" }),
          expect.objectContaining({ skuId: unpricedSku, reason: "PRICE_UNAVAILABLE" }),
          expect.objectContaining({
            skuId: invalidQuantitySku,
            reason: "INVALID_HISTORICAL_QUANTITY",
          }),
        ]),
      );
      expect(result.value.addedLines[0]?.currentUnitPriceMinor).not.toBe(99999);
      expect(result.value).not.toHaveProperty("cycleId");
      expect(result.value).not.toHaveProperty("promotionCodes");
    }
    expect(replay).toEqual(result);
    expect(wrongOwner).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("reports stale carts and an all-skipped outcome without mutation", async () => {
    const customerId = await customer();
    const inactiveSku = await sku({ skuActive: false });
    const orderId = await order(customerId, [{ skuId: inactiveSku, quantity: 1, name: "Gone" }]);
    const cart = await getCart(env.DB, { customerId, requestId: "all-skipped-cart", headers: {} });
    if (!cart.ok) throw new Error("cart setup failed");
    const stale = await reorderOrder(env.DB, {
      customerId,
      orderId,
      expectedCartVersion: cart.value.version + 1,
      idempotencyKey: `reorder-stale-${crypto.randomUUID()}`,
      requestId: "reorder-stale",
      headers: {},
    });
    const skipped = await reorderOrder(env.DB, {
      customerId,
      orderId,
      expectedCartVersion: cart.value.version,
      idempotencyKey: `reorder-skipped-${crypto.randomUUID()}`,
      requestId: "reorder-skipped",
      headers: {},
    });

    expect(stale).toMatchObject({ ok: false, error: { code: "CART_VERSION_CONFLICT" } });
    expect(skipped).toMatchObject({
      ok: true,
      value: { outcome: "NO_ITEMS_ADDED", newCartVersion: cart.value.version, addedLines: [] },
    });
  });
});
