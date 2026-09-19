import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { setCartItem } from "./cart";
import { clearCart } from "./clear-cart";
import { selectCartLocation } from "./select-cart-location";

async function fixture(options: { withQuote?: boolean } = {}) {
  const suffix = crypto.randomUUID();
  const customerId = `clear-customer-${suffix}`;
  const otherCustomerId = `clear-other-${suffix}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
    ).bind(customerId, `auth-${suffix}`, now, now),
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
    ).bind(otherCustomerId, `other-auth-${suffix}`, now, now),
  ]);
  const principal = { customerId, requestId: `request-${suffix}`, headers: {} };
  const selected = await selectCartLocation(env.DB, {
    ...principal,
    latitude: 10.32,
    longitude: 123.9,
    expectedVersion: 0,
    idempotencyKey: `location-${suffix}`,
  });
  if (!selected.ok) throw new Error(selected.error.message);
  const first = await setCartItem(env.DB, {
    ...principal,
    cartId: selected.value.cartId,
    skuId: "sku-red-onion-500g",
    quantity: 1,
    expectedVersion: selected.value.version,
    idempotencyKey: `first-${suffix}`,
  });
  if (!first.ok) throw new Error(first.error.message);
  const second = await setCartItem(env.DB, {
    ...principal,
    cartId: selected.value.cartId,
    skuId: "sku-tomato-1kg",
    quantity: 2,
    expectedVersion: first.value.version,
    idempotencyKey: `second-${suffix}`,
  });
  if (!second.ok) throw new Error(second.error.message);
  let quoteId: string | null = null;
  if (options.withQuote) {
    quoteId = `clear-quote-${suffix}`;
    const addressId = `clear-address-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,?,'Home','Customer','09','{}',10.3,123.9,'active',1,?,?)",
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
        selected.value.cartId,
        addressId,
        now + 60_000,
        `quote-key-${suffix}`,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO checkout_attempts
          (id,customer_id,cart_id,address_id,cycle_id,fulfillment_mode,zone_id,location_id,
           quote_version,status,idempotency_key,expires_at,version,created_at,updated_at)
         VALUES (?,?,?,?,NULL,'INSTANT','zone-cebu-city-core','location-cebu-central',
           1,'PROCESSING',?,?,1,?,?)`,
      ).bind(
        quoteId,
        customerId,
        selected.value.cartId,
        addressId,
        `attempt-key-${suffix}`,
        now + 60_000,
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO checkout_inventory_holds(id,checkout_attempt_id,inventory_pool_id,location_id,quantity,status,created_at,updated_at) VALUES (?,?, 'pool-red-onion','location-cebu-central',500,'HELD',?,?)",
      ).bind(`hold-${suffix}`, quoteId, now, now),
    ]);
  }
  return {
    ...principal,
    otherCustomerId,
    cartId: selected.value.cartId,
    version: second.value.version,
    quoteId,
  };
}

function command(data: Awaited<ReturnType<typeof fixture>>, idempotencyKey = crypto.randomUUID()) {
  return {
    customerId: data.customerId,
    cartId: data.cartId,
    expectedVersion: data.version,
    idempotencyKey,
    requestId: data.requestId,
    headers: {},
  };
}

describe("clearCart", () => {
  it("clears every line once, releases unpaid checkout state, and replays an immutable receipt", async () => {
    const data = await fixture({ withQuote: true });
    const input = command(data);
    const result = await clearCart(env.DB, input);
    expect(result).toMatchObject({
      ok: true,
      value: {
        cartId: data.cartId,
        outcome: "CLEARED",
        clearedLineCount: 2,
        releasedCheckoutAttempts: 1,
        newCartVersion: data.version + 1,
      },
    });
    expect(await clearCart(env.DB, input)).toEqual(result);
    expect(
      await env.DB.prepare(
        `SELECT c.version,
          (SELECT COUNT(*) FROM cart_item WHERE cart_id=c.id) lines,
          (SELECT status FROM checkout_quote WHERE id=?) quoteStatus,
          (SELECT status FROM checkout_attempts WHERE id=?) attemptStatus,
          (SELECT status FROM checkout_inventory_holds WHERE checkout_attempt_id=?) holdStatus
         FROM cart c WHERE c.id=?`,
      )
        .bind(data.quoteId, data.quoteId, data.quoteId, data.cartId)
        .first(),
    ).toEqual({
      version: data.version + 1,
      lines: 0,
      quoteStatus: "SUPERSEDED",
      attemptStatus: "EXPIRED",
      holdStatus: "RELEASED",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=? OR idempotency_key=?",
      )
        .bind(input.idempotencyKey, `${input.idempotencyKey}:quote:${data.quoteId}`)
        .first(),
    ).toEqual({ count: 2 });

    const later = await setCartItem(env.DB, {
      ...data,
      cartId: data.cartId,
      skuId: "sku-red-onion-500g",
      quantity: 1,
      expectedVersion: data.version + 1,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(later).toMatchObject({ ok: true, value: { version: data.version + 2 } });
    expect(await clearCart(env.DB, input)).toEqual(result);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM cart_item WHERE cart_id=?")
        .bind(data.cartId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("converges identical concurrent commands on one receipt and version advance", async () => {
    const data = await fixture();
    const input = command(data);
    const [first, second] = await Promise.all([clearCart(env.DB, input), clearCart(env.DB, input)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      value: { outcome: "CLEARED", newCartVersion: data.version + 1 },
    });
    expect(
      await env.DB.prepare("SELECT version FROM cart WHERE id=?").bind(data.cartId).first(),
    ).toEqual({ version: data.version + 1 });
  });

  it("records an empty Cart as a safe success without advancing its version", async () => {
    const data = await fixture();
    const first = await clearCart(env.DB, command(data));
    if (!first.ok) throw new Error(first.error.message);
    const emptyCommand = {
      ...command(data),
      expectedVersion: first.value.newCartVersion,
    };
    expect(await clearCart(env.DB, emptyCommand)).toMatchObject({
      ok: true,
      value: {
        outcome: "ALREADY_EMPTY",
        clearedLineCount: 0,
        newCartVersion: first.value.newCartVersion,
      },
    });
  });

  it("rejects wrong ownership, stale versions, and incompatible key reuse without deleting lines", async () => {
    const data = await fixture();
    expect(
      await clearCart(env.DB, { ...command(data), customerId: data.otherCustomerId }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await clearCart(env.DB, { ...command(data), expectedVersion: data.version - 1 }),
    ).toMatchObject({ ok: false, error: { code: "CART_VERSION_CONFLICT" } });
    const input = command(data);
    expect(await clearCart(env.DB, input)).toMatchObject({ ok: true });
    expect(
      await clearCart(env.DB, { ...input, expectedVersion: input.expectedVersion + 1 }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("fails closed while an accepted checkout payment can still settle", async () => {
    const data = await fixture({ withQuote: true });
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP','PROCESSING',?,1,?,?)",
    )
      .bind(crypto.randomUUID(), data.quoteId, data.customerId, crypto.randomUUID(), now, now)
      .run();
    expect(await clearCart(env.DB, command(data))).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        details: { reason: "CHECKOUT_PAYMENT_IN_PROGRESS" },
      },
    });
    expect(
      await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM cart_item WHERE cart_id=?) lines,(SELECT status FROM checkout_quote WHERE id=?) quoteStatus",
      )
        .bind(data.cartId, data.quoteId)
        .first(),
    ).toEqual({ lines: 2, quoteStatus: "ACTIVE" });
  });

  it("rolls back releases, deletion, audit, and receipt when a required effect fails", async () => {
    const data = await fixture({ withQuote: true });
    const input = command(data);
    await env.DB.prepare(
      `CREATE TRIGGER reject_clear_delete BEFORE DELETE ON cart_item
       WHEN OLD.cart_id='${data.cartId}' BEGIN SELECT RAISE(ABORT, 'injected clear failure'); END`,
    ).run();
    try {
      expect(await clearCart(env.DB, input)).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });
      expect(
        await env.DB.prepare(
          `SELECT
            (SELECT COUNT(*) FROM cart_item WHERE cart_id=?) lines,
            (SELECT status FROM checkout_quote WHERE id=?) quoteStatus,
            (SELECT status FROM checkout_inventory_holds WHERE checkout_attempt_id=?) holdStatus,
            (SELECT COUNT(*) FROM audit_event WHERE idempotency_key=?) audits,
            (SELECT COUNT(*) FROM idempotency_records WHERE scope='cart.clear' AND idempotency_key=?) receipts`,
        )
          .bind(data.cartId, data.quoteId, data.quoteId, input.idempotencyKey, input.idempotencyKey)
          .first(),
      ).toEqual({ lines: 2, quoteStatus: "ACTIVE", holdStatus: "HELD", audits: 0, receipts: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER reject_clear_delete");
    }
  });
});
