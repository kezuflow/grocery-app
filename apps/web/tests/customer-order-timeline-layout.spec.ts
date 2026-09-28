import { expect, test, type Page } from "@playwright/test";

const progress = {
  steps: [
    { key: "PAYMENT", state: "COMPLETE", achievedAt: "2026-09-21T00:00:00.000Z" },
    { key: "PACKED", state: "CURRENT", achievedAt: null },
    { key: "OUT_FOR_DELIVERY", state: "UPCOMING", achievedAt: null },
    { key: "DELIVERED", state: "UPCOMING", achievedAt: null },
  ],
  detail: "Your order is being packed.",
};

async function mockOrder(
  page: Page,
  scenario: { progress?: typeof progress; orderStatus?: string; fulfillmentStatus?: string } = {},
) {
  await page.route("**/api/commerce/orders/order-layout", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          orderId: "order-layout",
          orderNumber: "FM-LAYOUT-1",
          status: scenario.orderStatus ?? "COMMITTED",
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
            status: scenario.fulfillmentStatus ?? "PACKING",
            deliveryStatus: "UNASSIGNED",
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
          timeline: [],
          progress: scenario.progress ?? progress,
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

test("places the four order milestones above Items across responsive widths", async ({ page }) => {
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
  expect(progressLabels).toEqual(["Payment successful", "Packed", "Out for delivery", "Delivered"]);
  await expect(progress.getByRole("heading", { name: "Payment successful" })).toHaveClass(
    /text-\[var\(--fm-storefront-accent\)\]/,
  );
  await expect(page.getByRole("region", { name: "Order progress" }).locator("p")).toHaveText(
    "Your order is being packed.",
  );
  const [progressBox, firstMarkerBox] = await Promise.all([
    progress.boundingBox(),
    progress.locator("[data-timeline-marker]").first().boundingBox(),
  ]);
  expect(firstMarkerBox?.x).toBeGreaterThanOrEqual(progressBox?.x ?? 0);
  expect(firstMarkerBox?.y).toBeGreaterThanOrEqual(progressBox?.y ?? 0);

  const timelineHeading = page.getByRole("heading", { name: "Order progress" });
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

test("completed milestones and connectors use the exact green accent", async ({ page }) => {
  await mockOrder(page, {
    orderStatus: "FULFILLMENT_READY",
    fulfillmentStatus: "PACKED",
    progress: {
      steps: [
        { key: "PAYMENT", state: "COMPLETE", achievedAt: "2026-09-21T00:00:00.000Z" },
        { key: "PACKED", state: "COMPLETE", achievedAt: "2026-09-21T01:00:00.000Z" },
        { key: "OUT_FOR_DELIVERY", state: "CURRENT", achievedAt: null },
        { key: "DELIVERED", state: "UPCOMING", achievedAt: null },
      ],
      detail: "Your order is packed and awaiting handoff.",
    },
  });
  await page.goto("/orders/order-layout");
  const steps = page.getByRole("list", { name: "Order progress" });
  await expect(steps.locator('li[data-progress-state="COMPLETE"]')).toHaveCount(2);
  await expect(steps.locator("li").first().locator("[data-timeline-marker]")).toHaveCSS(
    "border-top-color",
    "rgb(0, 177, 79)",
  );
  await expect(steps.getByRole("heading", { name: "Packed" })).toHaveCSS(
    "color",
    "rgb(0, 177, 79)",
  );
  const connector = steps.locator("li").first().locator(".fm-order-progress-fill").first();
  await expect(connector).toHaveCSS("background-color", "rgb(0, 177, 79)");
  await expect(connector).toHaveCSS("opacity", "1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(connector).toHaveCSS("transition-duration", "0s");
});
