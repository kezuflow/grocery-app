import { expect, test, type Route } from "@playwright/test";

async function json(route: Route, value: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

for (const width of [1440, 390]) {
  test(`confirms cancellation in a Yes/No popup at ${width}px without optimistic completion`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const writes: Array<{ body: unknown; key: string | undefined }> = [];
    let releaseResponse!: () => void;
    const heldResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
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
          progress: {
            steps: [
              { key: "PAYMENT", state: "COMPLETE", achievedAt: "2026-08-30T00:00:00.000Z" },
              { key: "PACKED", state: "CURRENT", achievedAt: null },
              { key: "OUT_FOR_DELIVERY", state: "UPCOMING", achievedAt: null },
              { key: "DELIVERED", state: "UPCOMING", achievedAt: null },
            ],
            detail: "Your order is being prepared.",
          },
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
      writes.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()["idempotency-key"],
      });
      if (writes.length === 1) {
        await heldResponse;
        await route.abort("failed");
        return;
      }
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
    await expect(page.getByLabel("Order options").getByText("₱1,000.00")).toBeVisible();
    await expect(page.getByLabel("Order options").getByText("₱25.00")).toBeVisible();
    await page.getByRole("button", { name: "Cancel order", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this order?", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Reason for cancellation")).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "Yes, cancel order", exact: true }),
    ).toBeDisabled();
    await expect(dialog).toContainText("₱1,000.00");
    await expect(dialog).toContainText("₱25.00");
    await dialog.getByRole("button", { name: "No, keep order", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Cancel order", exact: true })).toBeFocused();
    expect(writes).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel order", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel order", exact: true }).click();
    await dialog.getByLabel("Reason for cancellation").fill("Plans changed");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../.wrangler/customer-cancel-popup-${width}.png`,
      animations: "disabled",
    });
    const yes = dialog.getByRole("button", { name: "Yes, cancel order", exact: true });
    await yes.focus();
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByRole("button", { name: "Requesting cancellation…", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "No, keep order", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    releaseResponse();
    await expect(
      dialog.getByText("The cancellation result is unknown. Retry the saved request."),
    ).toBeVisible();
    await expect(dialog.getByLabel("Reason for cancellation")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "No, keep order", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Retry saved cancellation", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(/Your refund is processing/)).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[0].body).toEqual({ expectedVersion: 3, reason: "Plans changed" });
    expect(writes[0].key).toBeTruthy();
    expect(writes[1]).toEqual(writes[0]);
  });
}
