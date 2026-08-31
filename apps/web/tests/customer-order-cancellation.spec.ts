import { expect, test, type Route } from "@playwright/test";

async function json(route: Route, value: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

test("confirms the Core refund preview and requests cancellation without optimistic completion", async ({
  page,
}) => {
  let cancellationRequest: Record<string, unknown> | undefined;
  await page.route("**/api/commerce/orders/order-cancel", (route) =>
    json(route, {
      ok: true,
      value: {
        orderId: "order-cancel",
        orderNumber: "FM-CANCEL-1",
        status: "COMMITTED",
        version: 3,
        committedAt: "2026-08-30T00:00:00.000Z",
        financial: {
          source: "CHECKOUT_QUOTE",
          currency: "PHP",
          merchandiseSubtotalMinor: 100_000,
          itemDiscountMinor: 0,
          orderDiscountMinor: 0,
          deliverySubtotalMinor: 0,
          deliveryFeeMinor: 0,
          deliveryDiscountMinor: 0,
          serviceFeeMinor: 2_500,
          taxMinor: 0,
          totalMinor: 102_500,
        },
        items: [],
        fulfillment: {
          mode: "INSTANT",
          status: null,
          deliveryStatus: null,
          cycleId: null,
          deliveryDate: null,
          promisedAt: "2026-08-30T01:00:00.000Z",
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
            deliveryNote: null,
          },
        },
        payments: [],
        refunds: [],
        amendments: [],
        issues: [],
        invoice: { status: "NOT_AVAILABLE", invoiceIdentifier: null, issuedAt: null },
        timeline: [],
        cancellation: {
          status: null,
          requiredRefundMinor: 100_000,
          retainedServiceFeeMinor: 2_500,
          currency: "PHP",
        },
        actions: [{ action: "CANCEL", available: true, disabledReason: null }],
      },
    }),
  );
  await page.route("**/api/commerce/orders/order-cancel/cancel", async (route) => {
    cancellationRequest = route.request().postDataJSON() as Record<string, unknown>;
    await json(route, {
      ok: true,
      requestId: "request-1",
      value: {
        cancellationId: "cancellation-1",
        status: "REFUNDS_PROCESSING",
        requiredRefundMinor: 100_000,
        retainedServiceFeeMinor: 2_500,
        currency: "PHP",
        refunds: [
          {
            paymentId: "payment-1",
            refundId: "refund-1",
            amountMinor: 100_000,
            status: "PROCESSING",
          },
        ],
      },
    });
  });

  await page.goto("/orders/order-cancel");
  await expect(page.getByText("Refund if canceled now")).toBeVisible();
  await expect(page.getByLabel("Order follow-up").getByText("₱1,000.00")).toBeVisible();
  await expect(page.getByLabel("Order follow-up").getByText("₱25.00")).toBeVisible();
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await page.getByLabel("Reason for cancellation").fill("Plans changed");
  await page.getByRole("button", { name: "Confirm cancellation" }).click();

  await expect(page.getByText(/not marked canceled yet/)).toBeVisible();
  expect(cancellationRequest).toEqual({ expectedVersion: 3, reason: "Plans changed" });
});
