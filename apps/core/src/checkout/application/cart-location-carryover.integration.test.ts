import { env } from "cloudflare:workers";
import { describe, expect, it, onTestFinished } from "vitest";
import { getCart, setCartItem } from "./cart";
import { selectCartLocation } from "./select-cart-location";
import { mergeGuestCart } from "./merge-guest-cart";

async function customer() {
  const customerId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
  )
    .bind(customerId, crypto.randomUUID())
    .run();
  return { customerId, headers: {}, requestId: crypto.randomUUID() };
}
async function selected() {
  const principal = await customer();
  const location = await selectCartLocation(env.DB, {
    ...principal,
    latitude: 10.32,
    longitude: 123.9,
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!location.ok) throw new Error(location.error.message);
  return { ...principal, ...location.value };
}

describe("explicit Cart location and guest carryover", () => {
  it("does not create a default-site Cart and handles concurrent identical selection once", async () => {
    const principal = await customer();
    expect(await getCart(env.DB, principal)).toMatchObject({
      ok: false,
      error: { code: "DELIVERY_LOCATION_REQUIRED" },
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM cart WHERE customer_id=?")
        .bind(principal.customerId)
        .first(),
    ).toEqual({ count: 0 });
    const input = {
      ...principal,
      latitude: 10.32,
      longitude: 123.9,
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
    };
    const results = await Promise.all([
      selectCartLocation(env.DB, input),
      selectCartLocation(env.DB, input),
    ]);
    expect(results[0]).toMatchObject({
      ok: true,
      value: { locationId: "location-cebu-central", version: 1 },
    });
    expect(results[1]).toEqual(results[0]);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM cart WHERE customer_id=?")
        .bind(principal.customerId)
        .first(),
    ).toEqual({ count: 1 });
    expect(await selectCartLocation(env.DB, { ...input, latitude: 10.33 })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });
  it("rejects selection without a capable fulfillment pin and leaves no Cart or success receipt", async () => {
    const capable = await env.DB.prepare(
      "SELECT location_id FROM location_capability WHERE capability='DISPATCH' AND enabled=1",
    ).all<{ location_id: string }>();
    onTestFinished(async () => {
      await env.DB.batch(
        capable.results.map((row) =>
          env.DB.prepare(
            "UPDATE location_capability SET enabled=1 WHERE location_id=? AND capability='DISPATCH'",
          ).bind(row.location_id),
        ),
      );
    });
    await env.DB.prepare(
      "UPDATE location_capability SET enabled=0 WHERE capability='DISPATCH'",
    ).run();
    const principal = await customer(),
      idempotencyKey = crypto.randomUUID();
    expect(
      await selectCartLocation(env.DB, {
        ...principal,
        latitude: 0,
        longitude: 0,
        expectedVersion: 0,
        idempotencyKey,
      }),
    ).toMatchObject({ ok: false, error: { code: "ADDRESS_UNSERVICEABLE" } });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM cart WHERE customer_id=?")
        .bind(principal.customerId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?")
        .bind(idempotencyKey)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("adds to existing quantities once and retains inactive known items as removable unavailable lines", async () => {
    const cart = await selected();
    const seeded = await setCartItem(env.DB, {
      ...cart,
      cartId: cart.cartId,
      skuId: "sku-red-onion-500g",
      quantity: 3,
      expectedVersion: cart.version,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!seeded.ok) throw new Error(seeded.error.message);
    await env.DB.prepare("UPDATE sku SET status='inactive' WHERE id='sku-potato-500g'").run();
    try {
      const input = {
        ...cart,
        expectedVersion: seeded.value.version,
        idempotencyKey: crypto.randomUUID(),
        items: [
          { skuId: "sku-red-onion-500g", quantity: 2 },
          { skuId: "sku-potato-500g", quantity: 1 },
        ],
      };
      const merged = await mergeGuestCart(env.DB, input);
      expect(merged).toMatchObject({ ok: true, value: { version: 3 } });
      expect(await mergeGuestCart(env.DB, input)).toEqual(merged);
      const view = await getCart(env.DB, cart);
      expect(view).toMatchObject({
        ok: true,
        value: {
          checkoutBlocked: true,
          items: expect.arrayContaining([
            expect.objectContaining({
              skuId: "sku-potato-500g",
              quantity: 1,
              availability: "UNAVAILABLE",
              unitPriceMinor: null,
              lineTotalMinor: null,
            }),
            expect.objectContaining({ skuId: "sku-red-onion-500g", quantity: 5 }),
          ]),
        },
      });
      expect(
        await mergeGuestCart(env.DB, { ...input, customerId: crypto.randomUUID() }),
      ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    } finally {
      await env.DB.prepare("UPDATE sku SET status='active' WHERE id='sku-potato-500g'").run();
    }
  });
  it("supersedes an unstarted quote atomically when the Cart destination changes", async () => {
    const cart = await selected();
    const quoteId = crypto.randomUUID();
    const addressId = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,?,'Home','Customer','09','{}',10.32,123.9,'active',1,?,?)",
      ).bind(addressId, cart.customerId, now, now),
      env.DB.prepare(
        `INSERT INTO checkout_quote
          (id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,
           subtotal_minor,total_minor,lines_json,status,version,expires_at,idempotency_key,created_at,updated_at)
         VALUES (?,?,?,?,?,NULL,'INSTANT','PHP',100,100,'[]','ACTIVE',1,?,?,?,?)`,
      ).bind(
        quoteId,
        quoteId,
        cart.customerId,
        cart.cartId,
        addressId,
        now + 60_000,
        crypto.randomUUID(),
        now,
        now,
      ),
    ]);
    const changed = await selectCartLocation(env.DB, {
      customerId: cart.customerId,
      headers: {},
      requestId: crypto.randomUUID(),
      latitude: 10.34,
      longitude: 123.94,
      expectedVersion: cart.version,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(changed).toMatchObject({ ok: true, value: { version: cart.version + 1 } });
    expect(
      await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?").bind(quoteId).first(),
    ).toEqual({ status: "SUPERSEDED" });
  });
  it("rolls back every merge line and receipt when the Cart version changes inside the transaction", async () => {
    const cart = await selected(),
      idempotencyKey = crypto.randomUUID();
    const racing = new Proxy(env.DB, {
      get(database, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await database
              .prepare("UPDATE cart SET version=version+1 WHERE id=?")
              .bind(cart.cartId)
              .run();
            return database.batch(statements);
          };
        const value = Reflect.get(database, property, database);
        return typeof value === "function" ? value.bind(database) : value;
      },
    });
    expect(
      await mergeGuestCart(racing, {
        ...cart,
        expectedVersion: cart.version,
        idempotencyKey,
        items: [
          { skuId: "sku-red-onion-500g", quantity: 2 },
          { skuId: "sku-potato-500g", quantity: 1 },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: "CART_VERSION_CONFLICT" } });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM cart_item WHERE cart_id=?")
        .bind(cart.cartId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?")
        .bind(idempotencyKey)
        .first(),
    ).toEqual({ count: 0 });
  });
});
