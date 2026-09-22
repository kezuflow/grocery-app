import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { addCartItemsBatch, getCart, setCartItem } from "./cart";
import { mergeGuestCart } from "./merge-guest-cart";
import { selectCartLocation } from "./select-cart-location";

async function customer() {
  const suffix = crypto.randomUUID();
  const customerId = `cart-customer-${suffix}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${suffix}`, now, now)
    .run();
  const principal = { customerId, requestId: `request-${suffix}`, headers: {} };
  const selected = await selectCartLocation(env.DB, {
    ...principal,
    latitude: 10.32,
    longitude: 123.9,
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!selected.ok) throw new Error(selected.error.message);
  return principal;
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
  if (options.priced || options.locationPrice !== undefined) {
    await env.DB.prepare(
      "INSERT INTO price_version (id, sku_id, currency, amount_minor, valid_from, market_id, location_id, price_type, version, created_at) VALUES (?, ?, 'PHP', ?, ?, 'market-metro-cebu', 'location-cebu-central', 'STANDARD', 1, ?)",
    )
      .bind(`price-location-${suffix}`, skuId, options.locationPrice ?? 11100, now - 1000, now)
      .run();
  }
  return skuId;
}

async function lockCartForPayment(customerId: string, cartId: string) {
  const suffix = crypto.randomUUID();
  const now = Date.now();
  const addressId = `cart-payment-address-${suffix}`;
  const quoteId = `cart-payment-quote-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer_address (id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,?,'Home','Customer','09','{}',10.3,123.9,'active',1,?,?)",
    ).bind(addressId, customerId, now, now),
    env.DB.prepare(
      `INSERT INTO checkout_quote
         (id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,
          subtotal_minor,total_minor,lines_json,status,version,expires_at,idempotency_key,created_at,updated_at)
         VALUES (?,?,?,?,?,NULL,'INSTANT','PHP',100,100,'[]','ACTIVE',1,?,?,?,?)`,
    ).bind(
      quoteId,
      quoteId,
      customerId,
      cartId,
      addressId,
      now + 60_000,
      `quote-${suffix}`,
      now,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP','PROCESSING',?,1,?,?)",
    ).bind(`payment-${suffix}`, quoteId, customerId, `payment-key-${suffix}`, now, now),
  ]);
}

describe("cart aggregate", () => {
  it("records safe read and write stage durations for a confirmed item update", async () => {
    const principal = await customer();
    const initial = await getCart(env.DB, principal);
    if (!initial.ok) throw new Error("cart setup failed");
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const idempotencyKey = `private-cart-key-${crypto.randomUUID()}`;
    try {
      const result = await setCartItem(env.DB, {
        ...principal,
        cartId: initial.value.id,
        skuId: "sku-red-onion-500g",
        quantity: 1,
        expectedVersion: initial.value.version,
        idempotencyKey,
      });
      expect(result.ok).toBe(true);
      const events = logged.mock.calls.map(([payload]) => JSON.parse(String(payload)));
      expect(events).toContainEqual(
        expect.objectContaining({
          event: "cart.read.completed",
          requestId: principal.requestId,
          promotionsMs: expect.any(Number),
          paymentGuardMs: expect.any(Number),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          event: "cart.setItem.completed",
          requestId: principal.requestId,
          batchMs: expect.any(Number),
          readMs: expect.any(Number),
        }),
      );
      expect(JSON.stringify(events)).not.toContain(initial.value.id);
      expect(JSON.stringify(events)).not.toContain(idempotencyKey);
      expect(JSON.stringify(events)).not.toContain("sku-red-onion-500g");
    } finally {
      logged.mockRestore();
    }
  });

  it("locks cart mutations while an accepted checkout payment is unresolved", async () => {
    const principal = await customer();
    const initial = await getCart(env.DB, principal);
    if (!initial.ok) throw new Error("cart setup failed");
    await lockCartForPayment(principal.customerId, initial.value.id);
    expect(await getCart(env.DB, principal)).toMatchObject({
      ok: true,
      value: { paymentInProgress: true },
    });

    const line = await setCartItem(env.DB, {
      ...principal,
      cartId: initial.value.id,
      skuId: "sku-red-onion-500g",
      quantity: 1,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-locked-${crypto.randomUUID()}`,
    });
    const batch = await addCartItemsBatch(env.DB, {
      ...principal,
      sourceOrderId: `order-${crypto.randomUUID()}`,
      cartId: initial.value.id,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-batch-locked-${crypto.randomUUID()}`,
      lines: [{ skuId: "sku-red-onion-500g", quantity: 1, productName: "Onion" }],
    });
    const merge = await mergeGuestCart(env.DB, {
      ...principal,
      cartId: initial.value.id,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-merge-locked-${crypto.randomUUID()}`,
      items: [{ skuId: "sku-red-onion-500g", quantity: 1 }],
    });
    const location = await selectCartLocation(env.DB, {
      ...principal,
      latitude: 10.32,
      longitude: 123.9,
      expectedVersion: initial.value.version,
      idempotencyKey: `cart-location-locked-${crypto.randomUUID()}`,
    });

    for (const result of [line, batch, merge, location])
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "CONFLICT",
          details: { reason: "CHECKOUT_PAYMENT_IN_PROGRESS" },
        },
      });
  });

  it("returns the selected Cart identity under concurrent reads", async () => {
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
    expect(applied).toMatchObject({
      ok: true,
      value: { version: 2, items: [{ name: "Red onion · 500 g" }] },
    });
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

  it("retains an over-quantity row with a specific blocker until the customer resolves it", async () => {
    const configuration = await env.DB.prepare(
      "SELECT fulfillment_mode FROM global_commerce_configuration WHERE id='global'",
    ).first<{ fulfillment_mode: string }>();
    await env.DB.prepare(
      "UPDATE global_commerce_configuration SET fulfillment_mode='INSTANT',version=version+1,updated_at=? WHERE id='global'",
    )
      .bind(Date.now())
      .run();
    const principal = await customer();
    const initial = await getCart(env.DB, principal);
    if (!initial.ok) throw new Error("cart setup failed");
    const applied = await setCartItem(env.DB, {
      ...principal,
      cartId: initial.value.id,
      skuId: "sku-red-onion-500g",
      quantity: 2,
      expectedVersion: initial.value.version,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!applied.ok) throw new Error(applied.error.message);
    const balance = await env.DB.prepare(
      `SELECT b.on_hand,b.reserved FROM inventory_balance b
       JOIN sku s ON COALESCE(s.stock_pool_id,(SELECT inventory_pool_id FROM product WHERE id=s.product_id))=b.inventory_pool_id
       WHERE s.id='sku-red-onion-500g' AND b.location_id='location-cebu-central'`,
    ).first<{ on_hand: number; reserved: number }>();
    if (!balance) throw new Error("inventory setup missing");
    try {
      await env.DB.prepare(
        `UPDATE inventory_balance SET on_hand=reserved
         WHERE location_id='location-cebu-central' AND inventory_pool_id=(
           SELECT COALESCE(s.stock_pool_id,p.inventory_pool_id) FROM sku s JOIN product p ON p.id=s.product_id
           WHERE s.id='sku-red-onion-500g')`,
      ).run();
      expect(await getCart(env.DB, principal)).toMatchObject({
        ok: true,
        value: {
          checkoutBlocked: true,
          blockingReasons: ["ITEM_UNAVAILABLE"],
          items: [
            expect.objectContaining({
              skuId: "sku-red-onion-500g",
              quantity: 2,
              availability: "UNAVAILABLE",
              unavailableReason: "INSUFFICIENT_QUANTITY",
              availableQuantity: 0,
            }),
          ],
        },
      });
      const resolved = await setCartItem(env.DB, {
        ...principal,
        cartId: initial.value.id,
        skuId: "sku-red-onion-500g",
        quantity: 0,
        expectedVersion: applied.value.version,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(resolved).toMatchObject({ ok: true, value: { checkoutBlocked: false, items: [] } });
    } finally {
      await env.DB.prepare(
        "UPDATE global_commerce_configuration SET fulfillment_mode=?,version=version+1,updated_at=? WHERE id='global'",
      )
        .bind(configuration?.fulfillment_mode ?? "SCHEDULED", Date.now())
        .run();
      await env.DB.prepare(
        `UPDATE inventory_balance SET on_hand=?,reserved=?
         WHERE location_id='location-cebu-central' AND inventory_pool_id=(
           SELECT COALESCE(s.stock_pool_id,p.inventory_pool_id) FROM sku s JOIN product p ON p.id=s.product_id
           WHERE s.id='sku-red-onion-500g')`,
      )
        .bind(balance.on_hand, balance.reserved)
        .run();
    }
  });

  it("uses the exact current location price", async () => {
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
