import { describe, expect, it, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import type { RpcResult } from "@freshmarkets/contracts";
import { locationManager } from "../../test-location-fixtures";
import { createCheckoutQuote } from "../../checkout/application/create-checkout-quote";
import { abandonCheckoutAttempt } from "../../checkout/application/abandon-checkout-attempt";
import { createCheckoutPaymentIntent } from "../../payments/application/create-checkout-payment-intent";
import { reconcilePayment } from "../../payments/application/reconcile-payment";
import {
  createMockPaymentProvider,
  setMockObservedState,
} from "../../payments/infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import { createMockDeliveryProvider } from "../../delivery/infrastructure/mock-delivery-provider";
import { applyCheckoutPaymentReaction } from "../../orders/application/apply-checkout-payment-reaction";
import { cancelOrder } from "../../orders/application/cancel-order";
import { sortInventoryStock } from "./sort-inventory-stock";

const locationId = "location-cebu-central";
function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(`INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission
    WHERE code IN ('catalog.read','catalog.manage','inventory.read','inventory.adjust','prices.read','prices.manage','transfers.read','transfers.manage')`)
    .bind(manager.id)
    .run();
  const meta = { headers: manager.headers, requestId: crypto.randomUUID() };
  const suffix = crypto.randomUUID();
  const product = value(
    await exports.default.createAdminProduct({
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      categoryId: "category-vegetables",
      name: `Counted broccoli ${suffix}`,
      slug: `counted-${suffix}`,
      description: null,
      inventoryBaseUnitId: "unit-gram",
      stockTracking: "COUNTED_SIZES",
      customerDetails: [],
    }),
  );
  const small = value(
    await exports.default.createAdminSku({
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      productId: product.productId,
      code: `SMALL-${suffix}`,
      name: "Small",
      sellableUnitId: "unit-piece",
      sellQuantity: 1,
      consumptionBaseQuantity: 1,
      estimatedShippingWeightGrams: 300,
      merchandisingLabel: "Pack",
    }),
  );
  const large = value(
    await exports.default.createAdminSku({
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      productId: product.productId,
      code: `LARGE-${suffix}`,
      name: "Large",
      sellableUnitId: "unit-piece",
      sellQuantity: 1,
      consumptionBaseQuantity: 1,
      estimatedShippingWeightGrams: 700,
      merchandisingLabel: "Pack",
    }),
  );
  if (!small.stockPoolId || !large.stockPoolId) throw new Error("Missing counted stock pools");
  const detail = value(
    await exports.default.getAdminProduct({
      ...meta,
      productId: product.productId,
      scopeKind: "GLOBAL",
    }),
  );
  const poolId = detail.inventoryPool.inventoryPoolId;
  value(
    await exports.default.adjustInventory({
      ...meta,
      locationId,
      inventoryPoolId: poolId,
      delta: 10000,
      expectedVersion: 0,
      reason: "Received bulk goods",
      idempotencyKey: crypto.randomUUID(),
    }),
  );
  const request = {
    ...meta,
    locationId,
    productId: product.productId,
    quantityGrams: 10000,
    sizeCounts: [
      { skuId: small.skuId, quantity: 3 },
      { skuId: large.skuId, quantity: 4 },
    ],
    expectedVersion: 1,
    reason: "Actual received counts",
    idempotencyKey: crypto.randomUUID(),
  };
  return { manager, meta, product, poolId, small, large, request };
}
async function balance(poolId: string | null | undefined) {
  if (!poolId) throw new Error("Missing pool");
  return (
    (await env.DB.prepare(
      "SELECT on_hand onHand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
    )
      .bind(locationId, poolId)
      .first<{ onHand: number; reserved: number; version: number }>()) ?? {
      onHand: 0,
      reserved: 0,
      version: 0,
    }
  );
}
describe("Actual counted stock through authenticated Core commands", () => {
  it("records actual sizes without converting approximate grams or leaving duplicate bulk stock", async () => {
    const f = await fixture();
    const result = value(await exports.default.sortInventoryStock(f.request));
    expect(await balance(f.poolId)).toMatchObject({ onHand: 0, version: 2 });
    expect(await balance(f.small.stockPoolId)).toMatchObject({ onHand: 3 });
    expect(await balance(f.large.stockPoolId)).toMatchObject({ onHand: 4 });
    expect(f.small.stockPoolId).not.toBe(f.large.stockPoolId);
    const evidence = await env.DB.prepare(
      "SELECT quantity_grams grams FROM inventory_sort WHERE id=?",
    )
      .bind(result.sortId)
      .first();
    expect(evidence).toMatchObject({ grams: 10000 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM inventory_ledger_entries WHERE reference_type='inventory_sort' AND reference_id=?",
      )
        .bind(result.sortId)
        .first(),
    ).toMatchObject({ count: 3 });
    expect(value(await exports.default.sortInventoryStock(f.request))).toEqual(result);
    expect(await balance(f.small.stockPoolId)).toMatchObject({ onHand: 3 });
    expect(
      await exports.default.adjustInventory({
        ...f.meta,
        locationId,
        inventoryPoolId: f.small.stockPoolId ?? "",
        delta: 3,
        expectedVersion: 1,
        reason: "Duplicate Add stock",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await exports.default.sortInventoryStock({ ...f.request, quantityGrams: 1 }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it.each([
    "inventory_sort",
    "inventory_sort_output",
    "inventory_balance",
    "inventory_ledger_entries",
    "audit_event",
    "idempotency_records",
  ])("rolls back every sorting effect when %s insertion is skipped", async (table) => {
    const f = await fixture();
    await env.DB.prepare(
      `CREATE TRIGGER counted_skip BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
    ).run();
    try {
      expect(await exports.default.sortInventoryStock(f.request)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(await balance(f.poolId)).toMatchObject({ onHand: 10000, version: 1 });
      expect(await balance(f.small.stockPoolId)).toMatchObject({ onHand: 0 });
      expect(await balance(f.large.stockPoolId)).toMatchObject({ onHand: 0 });
      expect(
        await env.DB.prepare("SELECT 1 FROM inventory_sort WHERE product_id=?")
          .bind(f.product.productId)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT 1 FROM idempotency_records WHERE idempotency_key=?")
          .bind(f.request.idempotencyKey)
          .first(),
      ).toBeNull();
    } finally {
      await env.DB.prepare("DROP TRIGGER counted_skip").run();
    }
  });
  it("allows one competing count operation against the same measured bulk", async () => {
    const f = await fixture();
    const results = await Promise.all([
      exports.default.sortInventoryStock({ ...f.request, quantityGrams: 6000 }),
      exports.default.sortInventoryStock({
        ...f.request,
        quantityGrams: 6000,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await balance(f.poolId)).toMatchObject({ onHand: 4000 });
    expect(await balance(f.small.stockPoolId)).toMatchObject({ onHand: 3 });
  });
  it("rejects a size from another product without stock or successful evidence", async () => {
    const f = await fixture();
    expect(
      await exports.default.sortInventoryStock({
        ...f.request,
        sizeCounts: [{ skuId: "sku-red-onion-500g", quantity: 2 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await balance(f.poolId)).toMatchObject({ onHand: 10000, version: 1 });
  });
});

it("holds exact size counts, commits after mock-provider confirmation and releases them on eligible cancellation", async () => {
  const f = await fixture();
  value(await exports.default.sortInventoryStock(f.request));
  for (const sku of [f.small, f.large]) {
    value(
      await exports.default.setAdminSkuAvailability({
        ...f.meta,
        skuId: sku.skuId,
        locationId,
        availabilityStatus: "AVAILABLE",
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    value(
      await exports.default.setAdminSkuPrice({
        ...f.meta,
        skuId: sku.skuId,
        locationId,
        marketId: "market-metro-cebu",
        currency: "PHP",
        amountMinor: 100000,
        validFrom: Date.now() - 1000,
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE global_commerce_configuration SET fulfillment_mode='INSTANT',selling_state='OPEN',cadence=NULL,version=version+1 WHERE id='global'",
    ),
    env.DB.prepare(
      "UPDATE fulfillment_location_readiness SET instant_promise_minutes=90,dispatch_ready=1,version=version+1 WHERE location_id=?",
    ).bind(locationId),
  ]);
  async function basket(skuId: string, quantity: number) {
    const customerId = crypto.randomUUID(),
      cartId = crypto.randomUUID(),
      addressId = crypto.randomUUID(),
      now = Date.now();
    // Customer/address/cart fixture only; catalog, stock, quote, payment and Order transitions use owning commands.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,delivery_zone_code,status,version,created_at,updated_at) VALUES (?,?,'Home','Fixture','+639171110000','{}',10.3,123.9,'CEBU_CITY_CORE','active',1,?,?)",
      ).bind(addressId, customerId, now, now),
      env.DB.prepare(
        "INSERT INTO cart(id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,?,'ACTIVE',1,?,?)",
      ).bind(cartId, customerId, locationId, now, now),
      env.DB.prepare("INSERT INTO cart_item(cart_id,sku_id,quantity) VALUES (?,?,?)").bind(
        cartId,
        skuId,
        quantity,
      ),
    ]);
    return {
      customerId,
      cartId,
      addressId,
      cartVersion: 1,
      deliveryCycleId: null,
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
  }
  const routeDistance = buildRouteDistancePort({
    ENVIRONMENT: "test",
    ROUTE_DISTANCE_PROVIDER: "mock",
  });
  const deliveryProviders = new Map([["lalamove", createMockDeliveryProvider()]]);
  const dependencies = {
    routeDistance,
    deliveryProviders,
    scheduledDeliveryPartner: { providerCode: "lalamove", serviceType: "MOTORCYCLE" },
    defaultInstantDeliveryPartner: {
      code: "lalamove" as const,
      displayName: "Lalamove",
      serviceType: "MOTORCYCLE",
      serviceLabel: "Motorcycle",
    },
  };
  const baskets = [await basket(f.small.skuId, 2), await basket(f.small.skuId, 2)];
  const quotes = await Promise.all(
    baskets.map((command) => createCheckoutQuote(env.DB, command, dependencies)),
  );
  expect(quotes.filter((result) => result.ok)).toHaveLength(1);
  const winningIndex = quotes.findIndex((result) => result.ok),
    winningRequest = baskets[winningIndex],
    quoted = quotes[winningIndex];
  if (!winningRequest || !quoted?.ok) throw new Error("No winning count Quote");
  const quote = quoted.value;
  expect(
    await env.DB.prepare(
      "SELECT quantity FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND inventory_pool_id=? AND status='HELD'",
    )
      .bind(quote.quoteId, f.small.stockPoolId ?? "")
      .first(),
  ).toMatchObject({ quantity: 2 });
  const largeBasket = await basket(f.large.skuId, 4);
  const largeQuote = await createCheckoutQuote(env.DB, largeBasket, dependencies);
  if (!largeQuote.ok) throw new Error(largeQuote.error.message);
  const largeVersion = await env.DB.prepare("SELECT version FROM checkout_quote WHERE id=?")
    .bind(largeQuote.value.quoteId)
    .first<{ version: number }>();
  if (!largeVersion) throw new Error("Missing Quote version");
  expect(
    await abandonCheckoutAttempt(env.DB, {
      customerId: largeBasket.customerId,
      quoteId: largeQuote.value.quoteId,
      expectedVersion: largeVersion.version,
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  const provider = createMockPaymentProvider(),
    registry = new ProviderRegistry("test", [provider]);
  const payment = await createCheckoutPaymentIntent(
    env.DB,
    registry,
    "mock",
    routeDistance,
    {
      customerId: winningRequest.customerId,
      headers: {},
      requestId: crypto.randomUUID(),
      checkoutAttemptId: quote.quoteId,
      expectedQuoteVersion: quote.attemptVersion,
      expectedPriceAcceptanceVersion: quote.priceAcceptanceVersion,
      expectedCurrency: quote.currency,
      expectedMerchandiseSubtotalMinor: quote.merchandiseSubtotalMinor,
      expectedItemDiscountMinor: quote.itemDiscountMinor,
      expectedOrderDiscountMinor: quote.orderDiscountMinor,
      expectedDeliverySubtotalMinor: quote.deliverySubtotalMinor,
      expectedDeliveryFeeMinor: quote.deliveryFeeMinor,
      expectedDeliveryDiscountMinor: quote.deliveryDiscountMinor,
      expectedTaxMinor: quote.taxMinor,
      expectedTotalMinor: quote.totalMinor,
      returnUrl: "https://freshmarkets.ph/checkout/payment",
      idempotencyKey: crypto.randomUUID(),
    },
    deliveryProviders,
  );
  if (!payment.ok) throw new Error(payment.error.message);
  const attempt = await env.DB.prepare(
    "SELECT provider_reference reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(payment.value.paymentIntentId)
    .first<{ reference: string }>();
  if (!attempt) throw new Error("Payment was not started");
  setMockObservedState(provider, attempt.reference, "SUCCEEDED");
  expect(
    await reconcilePayment(env.DB, registry, {
      paymentIntentId: payment.value.paymentIntentId,
      idempotencyKey: crypto.randomUUID(),
      actorId: "test",
      requestId: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  const reaction = await env.DB.prepare(
    "SELECT id FROM payment_reaction WHERE payment_intent_id=? AND reaction_type='COMMIT_ORDER'",
  )
    .bind(payment.value.paymentIntentId)
    .first<{ id: string }>();
  if (!reaction) throw new Error("Missing commitment reaction");
  const committed = await applyCheckoutPaymentReaction(env.DB, {
    reactionId: reaction.id,
    paymentIntentId: payment.value.paymentIntentId,
    checkoutAttemptId: quote.quoteId,
    canonicalPaymentState: "SUCCEEDED",
  });
  expect(committed).toMatchObject({ applied: true });
  if (!committed.orderId) throw new Error("Missing Order");
  expect(
    await env.DB.prepare(
      "SELECT base_quantity,base_unit_code_snapshot,shipping_weight_grams FROM order_item WHERE order_id=? AND sku_id=?",
    )
      .bind(committed.orderId, f.small.skuId)
      .first(),
  ).toMatchObject({
    base_quantity: 2,
    base_unit_code_snapshot: "PIECE",
    shipping_weight_grams: 600,
  });

  expect(await balance(f.small.stockPoolId)).toMatchObject({ onHand: 3, reserved: 2 });
  expect(await balance(f.large.stockPoolId)).toMatchObject({ onHand: 4, reserved: 0 });
  const order = await env.DB.prepare("SELECT version FROM grocery_order WHERE id=?")
    .bind(committed.orderId)
    .first<{ version: number }>();
  if (!order) throw new Error("Missing Order version");
  expect(
    await cancelOrder(env.DB, {
      orderId: committed.orderId,
      customerId: winningRequest.customerId,
      expectedVersion: order.version,
      reason: "Eligible customer cancellation",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(await balance(f.small.stockPoolId)).toMatchObject({ onHand: 3, reserved: 0 });
  expect(await balance(f.poolId)).toMatchObject({ onHand: 0, reserved: 0 });
});

it("receives and counts the same goods once while retaining sent weight and unresolved shortage", async () => {
  const f = await fixture(),
    warehouse = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO fulfillment_location(id,market_id,code,name,type,latitude,longitude,status,created_at,updated_at,purpose) VALUES (?,'market-metro-cebu',?,'Count warehouse','FULFILLMENT_CENTER',10.3,123.9,'active',0,0,'CENTRAL_WAREHOUSE')",
    ).bind(warehouse, warehouse),
    env.DB.prepare(
      "INSERT INTO location_capability(location_id,capability,enabled) VALUES (?,'INVENTORY',1),(?,'RECEIVING',1)",
    ).bind(warehouse, warehouse),
  ]);
  value(
    await exports.default.adjustInventory({
      ...f.meta,
      locationId: warehouse,
      inventoryPoolId: f.poolId,
      delta: 20000,
      expectedVersion: 0,
      reason: "Warehouse opening stock",
      idempotencyKey: crypto.randomUUID(),
    }),
  );
  const created = value(
    await exports.default.createInventoryTransfer({
      ...f.meta,
      sourceLocationId: warehouse,
      destinationLocationId: locationId,
      lines: [{ inventoryPoolId: f.poolId, quantityBase: 20000 }],
      reason: "Bulk dispatch",
      idempotencyKey: crypto.randomUUID(),
    }),
  );
  value(
    await exports.default.dispatchInventoryTransfer({
      ...f.meta,
      transferId: created.transferId,
      expectedVersion: 1,
      reason: "Sent weighed sack",
      idempotencyKey: crypto.randomUUID(),
    }),
  );
  const details = value(
    await exports.default.getInventoryTransfer({ ...f.meta, transferId: created.transferId }),
  );
  const line = details.lines[0];
  if (!line) throw new Error("Missing transfer line");
  expect(line.sizeOptions).toEqual(
    expect.arrayContaining([
      { skuId: f.small.skuId, name: "Small" },
      { skuId: f.large.skuId, name: "Large" },
    ]),
  );
  const receive = {
    ...f.meta,
    transferId: created.transferId,
    expectedVersion: 2,
    reason: "Received and counted actual goods",
    idempotencyKey: crypto.randomUUID(),
    lines: [
      {
        lineId: line.lineId,
        acceptedBase: 18000,
        shortageBase: 2000,
        sizeCounts: [
          { skuId: f.small.skuId, quantity: 20 },
          { skuId: f.large.skuId, quantity: 10 },
        ],
      },
    ],
  };
  await env.DB.prepare(
    "CREATE TRIGGER counted_second_output BEFORE INSERT ON inventory_sort_output WHEN NEW.sku_id=(SELECT id FROM sku WHERE name='Large' AND product_id=(SELECT product_id FROM inventory_sort WHERE id=NEW.sort_id)) BEGIN SELECT RAISE(IGNORE); END",
  ).run();
  try {
    expect(await exports.default.receiveInventoryTransfer(receive)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await balance(f.poolId)).toMatchObject({ onHand: 10000, version: 1 });
    expect(await balance(f.small.stockPoolId)).toMatchObject({ onHand: 0 });
    expect(
      value(
        await exports.default.getInventoryTransfer({ ...f.meta, transferId: created.transferId }),
      ),
    ).toMatchObject({ status: "IN_TRANSIT", version: 2, receipts: [], sorting: [] });
  } finally {
    await env.DB.prepare("DROP TRIGGER counted_second_output").run();
  }
  const accepted = value(await exports.default.receiveInventoryTransfer(receive));
  expect(accepted).toMatchObject({ status: "PARTIALLY_RECEIVED", version: 3 });
  expect(value(await exports.default.receiveInventoryTransfer(receive))).toEqual(accepted);
  expect(await balance(f.poolId)).toMatchObject({ onHand: 10000 });
  expect(await balance(f.small.stockPoolId)).toMatchObject({ onHand: 20 });
  expect(await balance(f.large.stockPoolId)).toMatchObject({ onHand: 10 });
  expect(
    value(
      await exports.default.getInventoryTransfer({ ...f.meta, transferId: created.transferId }),
    ),
  ).toMatchObject({
    lines: [
      {
        quantityBase: 20000,
        acceptedBase: 18000,
        outstandingBase: 2000,
        shortageBase: 2000,
        lostBase: 0,
      },
    ],
    sorting: expect.arrayContaining([
      {
        sortId: expect.any(String),
        lineId: line.lineId,
        quantityGrams: 18000,
        skuName: "Small",
        quantity: 20,
      },
    ]),
  });
});

it.each(["lost-response", "revoked-authority", "inactive-size"])(
  "handles %s at the complete sorting transaction",
  async (change) => {
    const f = await fixture();
    const actor = await env.DB.prepare("SELECT auth_user_id id FROM staff_identity WHERE id=?")
      .bind(f.manager.id)
      .first<{ id: string }>();
    if (!actor) throw new Error("Missing actor");
    const batch = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, "batch").mockImplementationOnce(async (statements) => {
      if (change === "revoked-authority")
        await env.DB.prepare(
          "DELETE FROM role_permission WHERE role_id=? AND permission_id=(SELECT id FROM permission WHERE code='inventory.adjust')",
        )
          .bind(f.manager.id)
          .run();
      if (change === "inactive-size")
        await env.DB.prepare("UPDATE sku SET status='inactive' WHERE id=?")
          .bind(f.large.skuId)
          .run();
      const result = await batch(statements);
      if (change === "lost-response") throw new Error("Lost committed response");
      return result;
    });
    const { headers: _headers, requestId, ...payload } = f.request;
    try {
      const result = await sortInventoryStock(env.DB, actor.id, requestId, Date.now(), payload);
      expect(result.ok).toBe(change === "lost-response");
    } finally {
      spy.mockRestore();
    }
    expect(await balance(f.poolId)).toMatchObject({
      onHand: change === "lost-response" ? 0 : 10000,
    });
    expect(await balance(f.small.stockPoolId)).toMatchObject({
      onHand: change === "lost-response" ? 3 : 0,
    });
    if (change === "lost-response")
      expect(await exports.default.sortInventoryStock(f.request)).toMatchObject({ ok: true });
  },
);
