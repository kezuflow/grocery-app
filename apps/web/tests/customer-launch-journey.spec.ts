import { expect, test, type Route } from "@playwright/test";

async function json(route: Route, value: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

test("presents membership and safe post-commit customer actions as one bounded journey", async ({
  page,
}) => {
  const actionRequests: Array<{ kind: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/membership", (route) =>
    json(route, {
      ok: true,
      value: {
        offer: {
          offerId: "offer-membership-monthly",
          code: "MEMBERSHIP_MONTHLY",
          name: "FreshMarkets Membership",
          amountMinor: 29_900,
          currency: "PHP",
          billingInterval: "CALENDAR_MONTH",
        },
        subscription: {
          subscriptionId: "subscription-1",
          state: "TRIALING",
          cancelAtPeriodEnd: false,
          scheduledCancellationAt: null,
          trialStartsAt: "2026-08-01T00:00:00.000Z",
          trialEndsAt: "2026-09-01T00:00:00.000Z",
          version: 2,
        },
        introductoryTrial: {
          status: "OPEN_SUBSCRIPTION",
          eligible: false,
          duration: "CALENDAR_MONTH",
        },
        recurringAuthorization: { status: "READY", ready: true },
        actions: {
          startTrial: { available: false, disabledReason: "OPEN_SUBSCRIPTION" },
          beginPaidEnrollment: { available: false, disabledReason: "OPEN_SUBSCRIPTION" },
          cancelImmediately: { available: false, disabledReason: "POLICY_UNAVAILABLE" },
          cancelAtPeriodEnd: { available: false, disabledReason: "POLICY_UNAVAILABLE" },
        },
      },
    }),
  );

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "FreshMarkets Membership" })).toBeVisible();
  await expect(page.getByText("₱299.00 per calendar month")).toBeVisible();
  await expect(page.getByText("TRIALING", { exact: true })).toBeVisible();
  await expect(page.getByText("READY", { exact: true })).toBeVisible();

  const order = {
    orderId: "order-1",
    orderNumber: "FM-2026-ORDER1",
    status: "COMMITTED",
    version: 2,
    committedAt: "2026-08-30T00:00:00.000Z",
    financial: {
      source: "CHECKOUT_QUOTE",
      currency: "PHP",
      merchandiseSubtotalMinor: 30_000,
      itemDiscountMinor: 0,
      orderDiscountMinor: 3_000,
      deliverySubtotalMinor: 2_000,
      deliveryFeeMinor: 1_500,
      deliveryDiscountMinor: 500,
      serviceFeeMinor: 0,
      taxMinor: 0,
      totalMinor: 28_500,
    },
    items: [
      {
        orderItemId: "item-1",
        skuId: "sku-red-onion-500g",
        productName: "Red onion",
        variantName: "500 g",
        unit: "pack",
        quantity: 2,
        baseQuantity: 1_000,
        unitPriceMinor: 15_000,
        lineTotalMinor: 30_000,
      },
    ],
    fulfillment: {
      mode: "SCHEDULED",
      status: "PICKING",
      deliveryStatus: "UNASSIGNED",
      cycleId: "cycle-1",
      deliveryDate: "2026-09-05T00:00:00.000Z",
      promisedAt: null,
      address: {
        label: "Home",
        recipient: "Ana",
        phone: "+63917",
        addressLine1: "Ayala Cebu",
        addressLine2: null,
        barangay: "Luz",
        city: "Cebu City",
        region: "Central Visayas",
        postalCode: "6000",
        countryCode: "PH",
        deliveryNote: "Call on arrival",
      },
    },
    payments: [
      {
        paymentId: "payment-1",
        purpose: "GROCERY_CHECKOUT",
        status: "SUCCEEDED",
        amountMinor: 28_500,
        currency: "PHP",
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:01.000Z",
      },
    ],
    refunds: [],
    amendments: [],
    issues: [],
    invoice: { status: "NOT_READY", invoiceIdentifier: null, issuedAt: null },
    timeline: [
      {
        eventId: "ORDER_COMMITTED:order-1",
        type: "ORDER_COMMITTED",
        title: "Order confirmed",
        description: "We confirmed your order after payment was verified.",
        status: "COMMITTED",
        occurredAt: "2026-08-30T00:00:00.000Z",
      },
    ],
    cancellation: {
      status: null,
      requiredRefundMinor: null,
      retainedServiceFeeMinor: null,
      currency: "PHP",
    },
    actions: [
      { action: "REORDER", available: true, disabledReason: null },
      { action: "SUBMIT_ISSUE", available: true, disabledReason: null },
      { action: "REQUEST_AMENDMENT", available: true, disabledReason: null },
      {
        action: "CANCEL",
        available: false,
        disabledReason: "ORDER_NOT_CANCELABLE",
      },
    ],
  };
  await page.route("**/api/commerce/orders/order-1", (route) =>
    json(route, { ok: true, value: order }),
  );
  await page.route("**/api/commerce/cart", (route) =>
    json(route, {
      ok: true,
      value: {
        id: "cart-current",
        version: 4,
        items: [],
        totalMinor: 0,
        currency: "PHP",
        checkoutBlocked: false,
        blockingReasons: [],
      },
    }),
  );
  await page.route("**/api/commerce/orders/order-1/reorder", async (route) => {
    actionRequests.push({
      kind: "reorder",
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await json(route, {
      ok: true,
      value: {
        outcome: "COMPLETE",
        cartId: "cart-current",
        newCartVersion: 5,
        addedLines: [
          {
            skuId: "sku-red-onion-500g",
            name: "Red onion",
            quantityAdded: 2,
            newQuantity: 2,
            currentUnitPriceMinor: 16_000,
            currency: "PHP",
          },
        ],
        skippedLines: [],
        requiresFulfillmentReview: true,
        requiresAddressReview: true,
      },
    });
  });
  await page.route("**/api/commerce/orders/order-1/issues", async (route) => {
    actionRequests.push({
      kind: "issue",
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await json(route, {
      ok: true,
      value: {
        issueId: "issue-1",
        orderId: "order-1",
        category: "POOR_QUALITY",
        status: "SUBMITTED",
        description: "Bruised produce",
        affectedOrderItemIds: ["item-1"],
        resolutionMessage: null,
        terminal: false,
        version: 1,
        createdAt: "2026-08-30T01:00:00.000Z",
        updatedAt: "2026-08-30T01:00:00.000Z",
      },
    });
  });
  await page.route("**/api/commerce/orders/order-1/amendments", async (route) => {
    actionRequests.push({
      kind: "amendment",
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await json(route, {
      ok: true,
      value: {
        amendmentId: "amendment-1",
        orderId: "order-1",
        status: "PENDING_PAYMENT",
        version: 1,
        financial: {
          source: "AMENDMENT_QUOTE",
          currency: "PHP",
          merchandiseSubtotalMinor: 16_000,
          itemDiscountMinor: 0,
          orderDiscountMinor: 0,
          deliverySubtotalMinor: 0,
          deliveryFeeMinor: 0,
          deliveryDiscountMinor: 0,
          serviceFeeMinor: 0,
          taxMinor: 0,
          totalMinor: 16_000,
        },
        lines: [],
      },
    });
  });
  await page.route("**/api/commerce/amendments/amendment-1/payment", async (route) => {
    actionRequests.push({
      kind: "amendment-payment",
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await json(route, {
      ok: true,
      value: {
        paymentIntentId: "payment-amendment-1",
        state: "PROCESSING",
        actionType: "NONE",
        redirectUrl: null,
        clientToken: null,
        expiresAt: null,
      },
    });
  });

  await page.goto("/orders/order-1");
  await expect(page.getByText("Order FM-2026-ORDER1")).toBeVisible();
  await expect(page.getByText("Order confirmed")).toBeVisible();
  await expect(page.getByText("This order can no longer be canceled.")).toBeVisible();
  await expect(page.getByText("An invoice is not yet available for this order.")).toBeVisible();

  await page.getByRole("button", { name: "Buy again" }).click();
  await expect(page.getByText(/2 items added at current prices/)).toBeVisible();
  expect(actionRequests.find((request) => request.kind === "reorder")?.body).toEqual({
    expectedCartVersion: 4,
  });

  await page.getByLabel("What went wrong?").selectOption("POOR_QUALITY");
  await page.getByLabel("Red onion").check();
  await page.getByLabel("Describe the issue").fill("Bruised produce");
  await page.getByRole("button", { name: "Submit issue" }).click();
  await expect(page.getByText("Your issue was submitted. Our team will review it.")).toBeVisible();

  await page.getByLabel("SKU code").fill("sku-red-onion-500g");
  await page.getByRole("button", { name: "Price addition" }).click();
  await expect(page.getByText("Separate addition total:")).toBeVisible();
  await page.getByRole("button", { name: "Accept total and pay" }).click();
  await expect(
    page.getByText("Payment is processing. The addition is not committed yet."),
  ).toBeVisible();
  expect(
    actionRequests.find((request) => request.kind === "amendment-payment")?.body,
  ).toMatchObject({
    expectedAmendmentVersion: 1,
    expectedCurrency: "PHP",
    expectedTotalMinor: 16_000,
  });
});
