import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { addCartItemsBatch, getCart, setCartItem } from "./cart";

async function customer() {
  const suffix = crypto.randomUUID();
  const customerId = `cart-customer-${suffix}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${suffix}`, now, now)
    .run();
  return { customerId, requestId: `request-${suffix}`, headers: {} };
}

async function cloneSku(options: { available: boolean; priced: boolean; locationPrice?: number }) {
  const suffix = crypto.randomUUID();
  const skuId = `cart-sku-${suffix}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sku (
      id, product_id, code, name, sellable_unit_id, consumption_base_quantity,
      status, sort_order, created_at, updated_at, merchandising_label, sell_quantity, version
    )
    SELECT ?, product_id, ?, ?, sellable_unit_id, consumption_base_quantity,
      'active', 999, ?, ?, merchandising_label, sell_quantity, 1
    FROM sku WHERE id='sku-red-onion-500g'`,
  )
    .bind(skuId, `CART_${suffix}`, `Cart SKU ${suffix}`, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (?, 'location-cebu-central', ?, 'PLANNED', 1)",
  )
    .bind(skuId, options.available ? "AVAILABLE" : "UNAVAILABLE")
    .run();
  if (options.priced) {
    await env.DB.prepare(
      "INSERT INTO price_version (id, sku_id, currency, amount_minor, valid_from, market_id, location_id, price_type, version, created_at) VALUES (?, ?, 'PHP', 11100, ?, 'market-metro-cebu', NULL, 'STANDARD', 1, ?)",
    )
      .bind(`price-generic-${suffix}`, skuId, now - 1000, now)
      .run();
  }
  if (options.locationPrice !== undefined) {
    await env.DB.prepare(
      "INSERT INTO price_version (id, sku_id, currency, amount_minor, valid_from, market_id, location_id, price_type, version, created_at) VALUES (?, ?, 'PHP', ?, ?, 'market-metro-cebu', 'location-cebu-central', 'STANDARD', 2, ?)",
    )
      .bind(`price-location-${suffix}`, skuId, options.locationPrice, now - 1000, now)
      .run();
  }
  return skuId;
}

describe("cart aggregate", () => {
  it("returns one identity under concurrent first touch", async () => {
    const principal = await customer();
    const results = await Promise.all(Array.from({ length: 4 }, () => getCart(env.DB, principal)));
    const ids = results.map((result) => (result.ok ? result.value.id : null));
    expect(new Set(ids).size).toBe(1);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM cart WHERE customer_id=? AND status='ACTIVE'",
    )
      .bind(principal.customerId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("guards versions, replays identical commands, rejects key reuse, and removes at zero", async () => {
    const principal = await customer();
    const initial = await getCart(env.DB, principal);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const command = {
      ...principal,
      sourceOrderId: `order-${crypto.randomUUID()}`,
      cartId: initial.value.id,
      skuId: "sku-red-onion-500g",
      quantity: 2,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-set-${crypto.randomUUID()}`,
    };
    const applied = await setCartItem(env.DB, command);
    expect(applied).toMatchObject({ ok: true, value: { version: 2 } });
    const replay = await setCartItem(env.DB, command);
    expect(replay).toMatchObject({ ok: true, value: { version: 2 } });
    const conflict = await setCartItem(env.DB, { ...command, quantity: 3 });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    const stale = await setCartItem(env.DB, {
      ...command,
      idempotencyKey: `cart-stale-${crypto.randomUUID()}`,
      quantity: 4,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "CART_VERSION_CONFLICT" } });
    const removed = await setCartItem(env.DB, {
      ...command,
      idempotencyKey: `cart-remove-${crypto.randomUUID()}`,
      expectedVersion: 2,
      quantity: 0,
    });
    expect(removed).toMatchObject({ ok: true, value: { version: 3, items: [] } });
  });

  it("rejects unavailable and unpriced additions", async () => {
    const principal = await customer();
    const initial = await getCart(env.DB, principal);
    if (!initial.ok) throw new Error("cart setup failed");
    const unavailableSku = await cloneSku({ available: false, priced: true });
    const unavailable = await setCartItem(env.DB, {
      ...principal,
      cartId: initial.value.id,
      skuId: unavailableSku,
      quantity: 1,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-unavailable-${crypto.randomUUID()}`,
    });
    expect(unavailable).toMatchObject({ ok: false, error: { code: "ITEM_UNAVAILABLE" } });

    const unpricedSku = await cloneSku({ available: true, priced: false });
    const unpriced = await setCartItem(env.DB, {
      ...principal,
      cartId: initial.value.id,
      skuId: unpricedSku,
      quantity: 1,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-unpriced-${crypto.randomUUID()}`,
    });
    expect(unpriced).toMatchObject({ ok: false, error: { code: "PRICE_UNAVAILABLE" } });
  });

  it("prefers a current location price over the market price", async () => {
    const principal = await customer();
    const initial = await getCart(env.DB, principal);
    if (!initial.ok) throw new Error("cart setup failed");
    const skuId = await cloneSku({ available: true, priced: true, locationPrice: 22200 });
    const applied = await setCartItem(env.DB, {
      ...principal,
      cartId: initial.value.id,
      skuId,
      quantity: 1,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-price-${crypto.randomUUID()}`,
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            skuId,
            availability: "AVAILABLE",
            unitPriceMinor: 22200,
            lineTotalMinor: 22200,
          }),
        ],
        checkoutBlocked: false,
      },
    });
  });

  it("atomically merges eligible batch lines, skips unavailable lines, and replays exactly", async () => {
    const principal = await customer();
    const initial = await getCart(env.DB, principal);
    if (!initial.ok) throw new Error("cart setup failed");
    const unavailableSku = await cloneSku({ available: false, priced: true });
    const command = {
      ...principal,
      sourceOrderId: `order-${crypto.randomUUID()}`,
      cartId: initial.value.id,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-batch-${crypto.randomUUID()}`,
      lines: [
        { skuId: "sku-red-onion-500g", quantity: 2, productName: "Historical onion" },
        { skuId: unavailableSku, quantity: 1, productName: "Unavailable item" },
      ],
    };

    const applied = await addCartItemsBatch(env.DB, command);
    const replay = await addCartItemsBatch(env.DB, command);

    expect(applied).toMatchObject({
      ok: true,
      value: {
        cartId: initial.value.id,
        newCartVersion: initial.value.version + 1,
        addedLines: [{ skuId: "sku-red-onion-500g", quantityAdded: 2, newQuantity: 2 }],
        skippedLines: [{ skuId: unavailableSku, reason: "LOCATION_UNAVAILABLE" }],
      },
    });
    expect(replay).toEqual(applied);
    const line = await env.DB.prepare(
      "SELECT quantity FROM cart_item WHERE cart_id=? AND sku_id='sku-red-onion-500g'",
    )
      .bind(initial.value.id)
      .first<{ quantity: number }>();
    expect(line?.quantity).toBe(2);

    const conflict = await addCartItemsBatch(env.DB, {
      ...command,
      lines: [{ skuId: "sku-red-onion-500g", quantity: 3, productName: "Changed" }],
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("returns a controlled all-skipped outcome without changing the cart version", async () => {
    const principal = await customer();
    const initial = await getCart(env.DB, principal);
    if (!initial.ok) throw new Error("cart setup failed");
    const unpricedSku = await cloneSku({ available: true, priced: false });

    const result = await addCartItemsBatch(env.DB, {
      ...principal,
      sourceOrderId: `order-${crypto.randomUUID()}`,
      cartId: initial.value.id,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-batch-none-${crypto.randomUUID()}`,
      lines: [{ skuId: unpricedSku, quantity: 1, productName: "Unpriced" }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: "NO_ITEMS_ADDED",
        newCartVersion: initial.value.version,
        addedLines: [],
        skippedLines: [{ reason: "PRICE_UNAVAILABLE" }],
      },
    });
  });
});
