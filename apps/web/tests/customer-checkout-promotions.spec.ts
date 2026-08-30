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
    expiresAt: "2026-09-01T00:00:00.000Z",
    currency: "PHP",
    merchandiseSubtotalMinor: 30_000,
    itemDiscountMinor: 0,
    orderDiscountMinor: 3_000,
    deliverySubtotalMinor: 2_000,
    deliveryDiscountMinor: 2_000,
    serviceFeeMinor: 0,
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

  await page.route("**/api/commerce/cart", (route) =>
    json(route, {
      ok: true,
      value: {
        id: "cart-1",
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
          optionId: "fulfillment-scheduled-1",
          mode: "SCHEDULED",
          eligible: true,
          unavailableReason: null,
          promisedAt: null,
          deliveryWindow: {
            startsAt: "2026-09-05T08:00:00.000Z",
            endsAt: "2026-09-06T08:00:00.000Z",
          },
          feePreview: {
            subtotalMinor: 2_000,
            discountMinor: 0,
            totalMinor: 2_000,
            currency: "PHP",
          },
          cycleId: "cycle-1",
          cutoffAt: "2026-09-04T00:00:00.000Z",
          provisional: true,
        },
      ],
    }),
  );
  await page.route("**/api/commerce/address", (route) =>
    json(route, {
      ok: true,
      value: [
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
            buildingUnit: null,
            landmark: null,
            gateGuard: null,
            deliveryNote: null,
            recipientInstruction: null,
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

  await page.goto("/checkout");
  await page.getByRole("radio", { name: /^Home/ }).check();
  await page.getByRole("textbox", { name: "Promotion code" }).fill(" save10 ");
  await page.getByRole("button", { name: "Add code" }).click();
  await page.getByRole("button", { name: /Scheduled delivery/ }).click();

  await expect.poll(() => quoteRequest?.promotionCodes).toEqual(["SAVE10"]);
  expect(quoteRequest).toMatchObject({ fulfillmentOptionId: "fulfillment-scheduled-1" });
  await expect(page.getByText("Promotion applied")).toBeVisible();
  await expect(page.getByText("Free delivery (automatically applied)")).toBeVisible();
  await expect(page.getByText("Merchandise promotion")).toBeVisible();
  await expect(page.getByText("Delivery promotion")).toBeVisible();
  await expect(page.getByText("₱270.00").first()).toBeVisible();

  await page
    .getByRole("button", { name: "Accept total and continue to payment", exact: true })
    .first()
    .click();
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
      expectedServiceFeeMinor: quote.serviceFeeMinor,
      expectedTaxMinor: quote.taxMinor,
      expectedTotalMinor: quote.totalMinor,
    });
});
