import { expect, test, type Page } from "@playwright/test";

const timeline = [
  ["confirmed", "Order confirmed"],
  ["preparing", "Preparing your order"],
  ["ready", "Ready for pickup"],
  ["delivery", "Out for delivery"],
].map(([eventId, title], index) => ({
  eventId,
  type: "ORDER_COMMITTED",
  title,
  description: `${title} update`,
  status: "COMMITTED",
  occurredAt: `2026-09-21T0${index}:00:00.000Z`,
}));

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

  const timelineHeading = page.getByRole("heading", { name: "Order timeline" });
  const itemsHeading = page.getByRole("heading", { name: "Items" });
  expect((await timelineHeading.boundingBox())?.y).toBeLessThan(
    (await itemsHeading.boundingBox())?.y ?? 0,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(progress).toBeVisible();
  const mobileOverflow = await progress.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(mobileOverflow).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});
