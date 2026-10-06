import { expect, test, type Route } from "@playwright/test";

async function json(route: Route, value: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

test("applies a promotion, presents Core totals, and accepts the exact quote version", async ({
  page,
}) => {
  let quoteRequest: Record<string, unknown> | undefined;
  let paymentRequest: Record<string, unknown> | undefined;
  const quote = {
    quoteId: "quote-promotion-1",
    attemptVersion: 4,
    priceAcceptanceVersion: 2,
    expiresAt: "2099-09-01T00:00:00.000Z",
    currency: "PHP",
    merchandiseSubtotalMinor: 30_000,
    itemDiscountMinor: 0,
    orderDiscountMinor: 3_000,
    deliverySubtotalMinor: 2_000,
    deliveryDiscountMinor: 2_000,
    taxMinor: 0,
    subtotalMinor: 30_000,
    discountMinor: 5_000,
    deliveryFeeMinor: 0,
    totalMinor: 27_000,
    lines: [],
    requestedPromotionCodes: ["SAVE10"],
    promotionFeedback: [{ code: "SAVE10", status: "APPLIED", message: "Promotion applied" }],
    promotionApplications: [
      {
        promotionId: "p1",
        code: "SAVE10",
        name: "Save ten",
        component: "MERCHANDISE",
        benefitType: "ORDER_PERCENT_DISCOUNT",
        amountMinor: 3_000,
        automatic: false,
      },
      {
        promotionId: "p2",
        code: "AUTO-FREE",
        name: "Free delivery",
        component: "DELIVERY",
        benefitType: "DELIVERY_FEE_WAIVER",
        amountMinor: 2_000,
        automatic: true,
      },
    ],
  };

  await page.context().addCookies([
    {
      name: "freshmarkets_browse_point_v2",
      value: encodeURIComponent(JSON.stringify({ latitude: 10.3173, longitude: 123.9058 })),
      url: test.info().project.use.baseURL ?? "http://localhost:3100",
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript(() =>
    localStorage.setItem(
      "freshmarkets.delivery-location.v3",
      JSON.stringify({
        displayAddress: "Ayala Center Cebu",
        coordinate: { latitude: 10.3173, longitude: 123.9058 },
        savedAddressId: null,
      }),
    ),
  );
  await page.route("**/api/serviceability", (route) =>
    json(route, {
      ok: true,
      value: { serviceable: true, fulfillmentLocation: { id: "test-location" } },
    }),
  );
  await page.route("**/api/commerce/cart", (route) =>
    json(route, {
      ok: true,
      value: {
        id: "cart-1",
        locationId: "test-location",
        version: 3,
        currency: "PHP",
        totalMinor: 30_000,
        checkoutBlocked: false,
        blockingReasons: [],
        items: [
          {
            skuId: "sku-1",
            quantity: 1,
            name: "Produce box",
            availability: "AVAILABLE",
            unitPriceMinor: 30_000,
            lineTotalMinor: 30_000,
          },
        ],
      },
    }),
  );
  await page.route("**/api/checkout/fulfillment-options", (route) =>
    json(route, {
      ok: true,
      value: [
        {
          optionId: "fulfillment-instant-1",
          mode: "INSTANT",
          eligible: true,
          unavailableReason: null,
          deliveryPartner: {
            code: "lalamove",
            displayName: "Lalamove",
            serviceType: "MOTORCYCLE",
            serviceLabel: "Motorcycle",
          },
          promisedAt: "2099-09-01T00:30:00.000Z",
          deliveryWindow: null,
          feePreview: {
            subtotalMinor: 2_000,
            discountMinor: 0,
            totalMinor: 2_000,
            currency: "PHP",
          },
          cycleId: null,
          cutoffAt: null,
          provisional: true,
        },
      ],
    }),
  );
  await page.route("**/api/checkout/bootstrap", (route) =>
    json(route, {
      ok: true,
      value: {
        addresses: [
          {
            id: "address-1",
            label: "Home",
            recipient: "Ana",
            phone: "+639171234567",
            components: {
              addressLine1: "Ayala Center Cebu",
              addressLine2: null,
              barangay: "Luz",
              city: "Cebu City",
              region: "Central Visayas",
              postalCode: "6000",
              countryCode: "PH",
            },
            confirmationSource: "USER_PIN",
            confirmedAt: "2026-08-30T00:00:00.000Z",
            instructions: {
              deliveryInstructions: null,
            },
            latitude: 10.3173,
            longitude: 123.9058,
            serviceable: true,
            serviceabilityReason: null,
            serviceAreaCode: "CEBU_CITY",
            deliveryZoneCode: "CEBU_CITY_CORE",
            resolutionVersion: 1,
            status: "active",
            version: 2,
          },
        ],
        profile: { accountPhone: null, defaultAddressId: null },
      },
    }),
  );
  await page.route("**/api/checkout/quote", async (route) => {
    quoteRequest = route.request().postDataJSON() as Record<string, unknown>;
    await json(route, { ok: true, value: quote });
  });
  await page.route("**/api/checkout/payment", async (route) => {
    paymentRequest = route.request().postDataJSON() as Record<string, unknown>;
    await json(route, {
      ok: true,
      value: {
        paymentIntentId: "payment-1",
        state: "PROCESSING",
        actionType: "NONE",
        redirectUrl: null,
        clientToken: null,
        expiresAt: null,
      },
    });
  });

  await page.goto("/cart");
  await page.getByRole("textbox", { name: "Promotion code" }).fill(" save10 ");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("link", { name: "Checkout", exact: true }).click();
  await page.getByRole("radio", { name: /^Home/ }).focus();
  await page.keyboard.press("Space");

  await expect.poll(() => quoteRequest?.promotionCodes).toEqual(["SAVE10"]);
  expect(quoteRequest).toMatchObject({ fulfillmentOptionId: "fulfillment-instant-1" });
  await expect(page.getByText("Promotion applied")).toBeVisible();
  await expect(page.getByText(/Free delivery.*Automatic/)).toBeVisible();
  await expect(page.getByText("Order discount")).toBeVisible();
  await expect(page.getByText("Delivery discount")).toBeVisible();
  await expect(page.getByText("₱270.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Continue to payment", exact: true }).first().click();
  await expect
    .poll(() => paymentRequest)
    .toMatchObject({
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
    });
});
