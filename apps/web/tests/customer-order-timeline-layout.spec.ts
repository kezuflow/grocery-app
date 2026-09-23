import { expect, test, type Page } from "@playwright/test";

const timeline = [
  {
    eventId: "payment",
    type: "PAYMENT_STATUS",
    title: "Payment successful",
    description: "Your payment is now succeeded.",
    status: "SUCCEEDED",
    occurredAt: "2026-09-21T00:00:00.000Z",
  },
  {
    eventId: "delivery",
    type: "DELIVERY_STATUS",
    title: "Courier assigned",
    description: "Your delivery is now assigned.",
    status: "ASSIGNED",
    occurredAt: "2026-09-21T05:00:00.000Z",
  },
  {
    eventId: "confirmed",
    type: "ORDER_COMMITTED",
    title: "Order placed",
    description: "Your payment was verified and your order was placed.",
    status: "COMMITTED",
    occurredAt: "2026-09-21T01:00:00.000Z",
  },
  {
    eventId: "preparing",
    type: "FULFILLMENT_STATUS",
    title: "Packing order",
    description: "Order preparation is now packing.",
    status: "PACKING",
    occurredAt: "2026-09-21T04:00:00.000Z",
  },
];

async function mockOrder(page: Page) {
  await page.route("**/api/commerce/orders/order-layout", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          orderId: "order-layout",
          orderNumber: "FM-LAYOUT-1",
          status: "COMMITTED",
          version: 1,
          committedAt: "2026-09-21T00:00:00.000Z",
          financial: {
            source: "CHECKOUT_QUOTE",
            currency: "PHP",
            merchandiseSubtotalMinor: 10_000,
            itemDiscountMinor: 0,
            orderDiscountMinor: 0,
            deliverySubtotalMinor: 0,
            deliveryFeeMinor: 0,
            deliveryDiscountMinor: 0,
            serviceFeeMinor: 0,
            taxMinor: 0,
            totalMinor: 10_000,
          },
          items: [
            {
              orderItemId: "item-1",
              skuId: "sku-1",
              productName: "Mango",
              variantName: "1 kg",
              unit: "pack",
              quantity: 1,
              baseQuantity: 1,
              unitPriceMinor: 10_000,
              lineTotalMinor: 10_000,
            },
          ],
          fulfillment: {
            mode: "INSTANT",
            status: "READY",
            deliveryStatus: "ASSIGNED",
            cycleId: null,
            deliveryDate: null,
            promisedAt: "2026-09-21T05:00:00.000Z",
            address: {
              label: "Home",
              recipient: "Customer",
              phone: null,
              addressLine1: "Cebu City",
              addressLine2: null,
              barangay: null,
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
          timeline,
          cancellation: {
            status: null,
            requiredRefundMinor: 10_000,
            retainedServiceFeeMinor: 0,
            currency: "PHP",
          },
          actions: [],
        },
      }),
    }),
  );
}

test("places the horizontal order timeline above Items across responsive widths", async ({
  page,
}) => {
  await mockOrder(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/orders/order-layout");

  const progress = page.getByRole("list", { name: "Order progress" });
  await expect(progress).toBeVisible();
  await expect(progress.locator("[data-timeline-marker] svg")).toHaveCount(4);
  const desktopPositions = await progress.locator("li").evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }),
  );
  expect(desktopPositions.map(({ x }) => x)).toEqual(
    desktopPositions.map(({ x }) => x).sort((a, b) => a - b),
  );
  expect(new Set(desktopPositions.map(({ y }) => Math.round(y))).size).toBe(1);
  const progressLabels = await progress.getByRole("heading").allTextContents();
  expect(progressLabels).toEqual([
    "Payment successful",
    "Order placed",
    "Packing order",
    "Courier assigned",
  ]);
  await expect(progress.getByRole("heading", { name: "Payment successful" })).toHaveClass(
    /text-\[var\(--fm-success\)\]/,
  );
  await expect(page.getByRole("region", { name: "Order timeline" }).locator("p")).toHaveText(
    "Your delivery is now assigned.",
  );
  const [progressBox, firstMarkerBox] = await Promise.all([
    progress.boundingBox(),
    progress.locator("[data-timeline-marker]").first().boundingBox(),
  ]);
  expect(firstMarkerBox?.x).toBeGreaterThanOrEqual(progressBox?.x ?? 0);
  expect(firstMarkerBox?.y).toBeGreaterThanOrEqual(progressBox?.y ?? 0);

  const timelineHeading = page.getByRole("heading", { name: "Order timeline" });
  const itemsHeading = page.getByRole("heading", { name: "Items" });
  expect((await timelineHeading.boundingBox())?.y).toBeLessThan(
    (await itemsHeading.boundingBox())?.y ?? 0,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(progress).toBeVisible();
  expect(await progress.evaluate((element) => element.scrollWidth)).toBe(
    await progress.evaluate((element) => element.clientWidth),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});
