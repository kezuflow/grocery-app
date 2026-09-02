import type {
  CartView,
  CheckoutQuoteView,
  CustomerAddressView,
  FulfillmentOptionView,
  PaymentActionView,
  RpcResult,
} from "@freshmarkets/contracts";
import type { APIResponse, Page } from "@playwright/test";
import { executeAdminE2eSql, expect, test } from "./admin-authenticated-fixture";

type PreparedPayment = {
  action: PaymentActionView;
  returnPath: string;
};

const appOrigin =
  process.env.E2E_START_STACK === "1"
    ? "http://localhost:3100"
    : (process.env.APP_BASE_URL ?? "http://localhost:3000");

async function value<T>(response: APIResponse, operation: string): Promise<T> {
  expect(response.status(), `${operation} HTTP status`).toBeLessThan(400);
  const result = (await response.json()) as RpcResult<T>;
  if (!result.ok)
    throw new Error(`${operation} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

async function prepareInstantPayment(page: Page): Promise<PreparedPayment> {
  const suffix = crypto.randomUUID();
  const now = Date.now();
  executeAdminE2eSql(`
    UPDATE global_fulfillment_mode
      SET active_mode='INSTANT',cadence=NULL,version=version+1,updated_at=${now}
      WHERE id='global';
    UPDATE fulfillment_location_readiness
      SET instant_promise_minutes=30,max_concurrent_instant_orders=20,
          dispatch_ready=1,version=version+1,updated_at=${now}
      WHERE location_id='location-cebu-central';
    UPDATE delivery_zone_fee
      SET instant_fee_minor=5000, updated_at=${now}
      WHERE zone_id='zone-cebu-city-core' AND location_id='location-cebu-central';
    INSERT INTO delivery_fee_configuration (
      id, market_id, location_id, currency, minimum_delivery_fee_minor,
      per_kilometer_rate_minor, status, version, effective_from, effective_to,
      created_at, updated_at
    ) VALUES (
      'payment-e2e-delivery-fee', 'market-metro-cebu', 'location-cebu-central',
      'PHP', 5000, 2500, 'ACTIVE', 1, 0, NULL, ${now}, ${now}
    ) ON CONFLICT(id) DO UPDATE SET updated_at=${now};
    INSERT OR IGNORE INTO service_fee_configuration (
      id, fee_type, flat_minor, percentage_basis_points, currency,
      effective_from, effective_to, version, created_by_staff_id, reason, created_at
    ) VALUES (
      'payment-e2e-service-fee', 'FLAT', 2000, 0, 'PHP',
      0, NULL, 1, NULL, 'Playwright payment journey', ${now}
    );
  `);

  const cart = await value<CartView>(
    await page.request.get("/api/commerce/cart"),
    "load customer cart",
  );
  const address = await value<CustomerAddressView>(
    await page.request.post("/api/commerce/address", {
      data: {
        label: "Payment test home",
        recipient: "Payment Test Customer",
        phone: "+639171234567",
        components: {
          addressLine1: "Cebu Business Park",
          addressLine2: null,
          barangay: "Luz",
          city: "Cebu City",
          region: "Central Visayas",
          postalCode: "6000",
          countryCode: "PH",
        },
        componentsSource: "FIRST_PARTY",
        latitude: 10.32,
        longitude: 123.9,
        confirmationSource: "USER_PIN",
        instructions: {
          buildingUnit: null,
          landmark: null,
          gateGuard: null,
          deliveryNote: null,
          recipientInstruction: null,
        },
      },
    }),
    "create serviceable address",
  );
  const cartWithItem = await value<CartView>(
    await page.request.post("/api/commerce/cart", {
      data: {
        cartId: cart.id,
        skuId: "sku-red-onion-500g",
        quantity: 4,
        expectedVersion: cart.version,
        idempotencyKey: `payment-e2e-cart-${suffix}`,
      },
    }),
    "add checkout item",
  );
  const options = await value<readonly FulfillmentOptionView[]>(
    await page.request.post("/api/checkout/fulfillment-options", {
      data: {
        addressId: address.id,
        addressVersion: address.version,
        cartId: cartWithItem.id,
        cartVersion: cartWithItem.version,
      },
    }),
    "load fulfillment options",
  );
  const instant = options.find((option) => option.mode === "INSTANT" && option.eligible);
  if (!instant) throw new Error(`Instant fulfillment unavailable: ${JSON.stringify(options)}`);
  const quote = await value<CheckoutQuoteView>(
    await page.request.post("/api/checkout/quote", {
      headers: { "idempotency-key": `payment-e2e-quote-${suffix}` },
      data: {
        cartId: cartWithItem.id,
        cartVersion: cartWithItem.version,
        addressId: address.id,
        fulfillmentOptionId: instant.optionId,
      },
    }),
    "create checkout quote",
  );
  const returnPath = "/orders";
  const action = await value<PaymentActionView>(
    await page.request.post("/api/checkout/payment", {
      headers: { "idempotency-key": `payment-e2e-intent-${suffix}` },
      data: {
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
        expectedServiceFeeMinor: quote.serviceFeeMinor,
        expectedTaxMinor: quote.taxMinor,
        expectedTotalMinor: quote.totalMinor,
        returnUrl: new URL(returnPath, appOrigin).toString(),
      },
    }),
    "create payment intent",
  );
  expect(action).toMatchObject({ state: "REQUIRES_ACTION", actionType: "REDIRECT" });
  expect(action.redirectUrl).toContain("/development/mock-payments/");
  return { action, returnPath };
}

test("mock checkout commits only after a verified provider event", async ({ signedInPage }) => {
  const prepared = await prepareInstantPayment(signedInPage);

  await signedInPage.goto(prepared.returnPath);
  await expect(signedInPage.getByText("No orders in this view yet.")).toBeVisible();

  await signedInPage.goto(prepared.action.redirectUrl!);
  await signedInPage.getByRole("button", { name: "Approve test payment" }).click();
  await expect(signedInPage.getByText("Order confirmed")).toBeVisible();
  await expect(signedInPage.locator('a[href^="/orders/"]')).toBeVisible();
});

test("browser return without a provider event cannot commit an order", async ({ signedInPage }) => {
  const prepared = await prepareInstantPayment(signedInPage);

  await signedInPage.goto(prepared.returnPath);
  await expect(signedInPage.getByText("No orders in this view yet.")).toBeVisible();
});

test("a declined mock payment remains uncommitted", async ({ signedInPage }) => {
  const prepared = await prepareInstantPayment(signedInPage);

  await signedInPage.goto(prepared.action.redirectUrl!);
  await signedInPage.getByRole("button", { name: "Decline test payment" }).click();
  await expect(signedInPage.getByText("Test payment declined")).toBeVisible();
  await signedInPage.goto(prepared.returnPath);
  await expect(signedInPage.getByText("No orders in this view yet.")).toBeVisible();
});
