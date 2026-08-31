import { expect, test, type Route } from "@playwright/test";

async function json(route: Route, value: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

test("customer sees cancellation progress and a provisional transaction summary", async ({
  page,
}) => {
  const financial = {
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
  } as const;
  await page.route("**/api/commerce/orders/order-summary", (route) =>
    json(route, {
      ok: true,
      value: {
        orderId: "order-summary",
        orderNumber: "FM-SUMMARY-1",
        status: "CANCELLATION_REQUESTED",
        version: 4,
        committedAt: "2026-08-31T00:00:00.000Z",
        financial,
        items: [],
        fulfillment: {
          mode: "INSTANT",
          status: null,
          deliveryStatus: null,
          cycleId: null,
          deliveryDate: null,
          promisedAt: null,
          address: {
            label: "Home",
            recipient: "Ana",
            phone: null,
            addressLine1: "Cebu City",
            addressLine2: null,
            barangay: null,
            city: "Cebu City",
            region: null,
            postalCode: null,
            countryCode: "PH",
            deliveryNote: null,
          },
        },
        payments: [],
        refunds: [],
        amendments: [],
        issues: [],
        invoice: { status: "NOT_READY", invoiceIdentifier: null, issuedAt: null },
        timeline: [],
        cancellation: {
          status: "REFUNDS_PROCESSING",
          requiredRefundMinor: 100_000,
          retainedServiceFeeMinor: 2_500,
          currency: "PHP",
        },
        actions: [
          { action: "VIEW_TRANSACTION_SUMMARY", available: true, disabledReason: null },
          { action: "CANCEL", available: false, disabledReason: "CANCELLATION_ALREADY_REQUESTED" },
        ],
      },
    }),
  );
  await page.route("**/api/commerce/orders/order-summary/transaction-summary", (route) =>
    json(route, {
      ok: true,
      value: {
        documentKind: "PROVISIONAL_TRANSACTION_SUMMARY",
        disclaimer: "NOT AN OFFICIAL BIR INVOICE",
        orderNumber: "FM-SUMMARY-1",
        committedAt: "2026-08-31T00:00:00.000Z",
        currency: "PHP",
        buyer: { recipient: "Ana", addressLines: ["Cebu City"] },
        lines: [],
        financial,
        payments: [],
        refunds: [],
        amendments: [],
        officialInvoice: { status: "NOT_READY", identifier: null },
      },
    }),
  );

  await page.goto("/orders/order-summary");
  await expect(page.getByText("Cancellation is already being processed.")).toBeVisible();
  await page.getByRole("link", { name: "View transaction summary" }).click();
  await expect(page.getByRole("heading", { name: "Transaction summary" })).toBeVisible();
  await expect(page.getByText("NOT AN OFFICIAL BIR INVOICE").first()).toBeVisible();
  await expect(page.getByText("FreshMarkets Service Fee")).toBeVisible();
});
