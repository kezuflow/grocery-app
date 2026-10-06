import { expect, test, type Page } from "@playwright/test";
import type { AdminOrderDetail, FulfillmentQueueView } from "@freshmarkets/contracts";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

function queueOrder(index: number): FulfillmentQueueView {
  return {
    orderId: `print-order-${index}`,
    cycleId: null,
    locationId: "location-cebu-central",
    status: "NOT_STARTED",
    version: 1,
    allowedActions: [],
    operational: {
      orderNumber: `FM-PRINT-${index}`,
      committedAt: "2026-10-06T01:00:00.000Z",
      fulfillmentMode: "INSTANT",
      progress: "NEW",
      recipient: { name: `Test recipient ${index}`, phone: "Test phone" },
      timing: {
        cycleName: null,
        windowName: null,
        startsAt: null,
        endsAt: null,
        pickupAt: null,
        timezone: "Asia/Manila",
      },
      deliveryStatus: null,
      blockers: [],
      lines: [
        {
          lineId: "line",
          source: "ORIGINAL",
          productName: "Tomato",
          variantName: "1 kg",
          unit: "pack",
          quantity: 2,
          baseQuantity: 2000,
          baseUnit: "g",
          goods: {
            kind: "INSTANT_RESERVATION",
            status: "RESERVED",
            allocatedBase: 2000,
            receivedBase: null,
          },
        },
      ],
    },
  };
}
function receipt(index: number): AdminOrderDetail {
  const item = queueOrder(index);
  return {
    orderId: item.orderId,
    orderNumber: item.operational!.orderNumber,
    customerName: `Test recipient ${index}`,
    customerEmail: "test@example.com",
    fulfillmentMode: "INSTANT",
    status: "COMMITTED",
    totalMinor: 12500,
    currency: "PHP",
    paymentStatus: "SUCCEEDED",
    fulfillmentStatus: "NOT_STARTED",
    deliveryStatus: null,
    deliveryDispatchStatus: null,
    deliveryProviderStatus: null,
    committedAt: item.operational!.committedAt,
    version: 1,
    allowedActions: [],
    customer: {
      name: `Test recipient ${index}`,
      email: "test@example.com",
      phone: "Test phone",
      addressLines: ["Test delivery street", "Cebu City"],
    },
    financial: {
      subtotalMinor: 10000,
      discountMinor: 0,
      deliveryFeeMinor: 2500,
      serviceFeeMinor: 0,
      taxMinor: 0,
      totalMinor: 12500,
      currency: "PHP",
      source: "CHECKOUT_QUOTE",
    },
    items: [
      {
        productName: "Tomato",
        variantName: "1 kg",
        unit: "pack",
        quantity: 2,
        baseQuantity: 2000,
        unitPriceMinor: 5000,
        lineTotalMinor: 10000,
      },
    ],
    payments: [],
    amendments: [],
    fulfillment: {
      locationId: item.locationId,
      cycleId: null,
      zoneId: null,
      fulfillmentMode: "INSTANT",
      cutoffAt: null,
      deliveryDate: null,
      promisedAt: null,
      sourcingModes: [],
      status: "NOT_STARTED",
      version: 1,
      updatedAt: null,
    },
    delivery: null,
    exceptions: [],
    timeline: [],
    recentAudit: [],
  };
}
async function bootstrap(page: Page, printAccess = true) {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "print-staff",
      displayName: "Print staff",
      email: "print@example.com",
      capabilities: printAccess ? ["fulfillment.read", "orders.read"] : ["fulfillment.read"],
      scopes: printAccess
        ? [{ kind: "global" }]
        : [{ kind: "location", locationId: "location-cebu-central" }],
      navigation: [],
      environment: "test",
    },
    scopes: [
      {
        kind: "location",
        marketId: "market-e2e",
        marketCode: "CEBU",
        locationId: "location-cebu-central",
        locationCode: "CENTRAL",
        locationName: "Central Cebu",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
    ],
    selectedScope: {
      kind: "LOCATION",
      marketId: "market-e2e",
      locationId: "location-cebu-central",
    },
    timezone: "Asia/Manila",
  });
  await page.route("**/api/admin/operations-activity**", (route) =>
    route.fulfill({
      json: { ok: true, requestId: "activity", value: { notifications: [], latest: null } },
    }),
  );
}

for (const width of [1440, 390]) {
  test(`Fulfillment selects/prints one or 50 orders and clears pagination selections at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    await bootstrap(page);
    await page.setViewportSize({ width, height: 900 });
    const queries: URLSearchParams[] = [];
    let detailReads = 0;
    await page.route("**/api/admin/fulfillment?**", (route) => {
      const params = new URL(route.request().url()).searchParams;
      queries.push(params);
      return route.fulfill({
        json: {
          ok: true,
          requestId: "queue",
          value: {
            items: params.has("cursor")
              ? [queueOrder(51)]
              : Array.from({ length: 50 }, (_, index) => queueOrder(index + 1)),
            nextCursor: params.has("cursor") ? null : "page-two",
          },
        },
      });
    });
    await page.route("**/api/admin/orders/print-order-*", (route) => {
      detailReads++;
      return route.fulfill({
        json: {
          ok: true,
          requestId: "receipt",
          value: receipt(Number(route.request().url().split("-").at(-1))),
        },
      });
    });
    await page.goto("/admin/fulfillment");
    await expect(
      page.getByRole("checkbox", { name: "Select all orders on this page" }),
    ).toBeVisible();
    expect(queries.at(-1)?.get("limit")).toBe("50");
    await page
      .getByRole("checkbox", { name: "Select order FM-PRINT-2 for printing", exact: true })
      .focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Order FM-PRINT-1", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Print selected orders", exact: true }).click();
    const preview = page.frameLocator('iframe[title="Selected order receipts"]');
    await expect(preview.getByRole("heading", { name: "FM-PRINT-2", exact: true })).toBeVisible();
    await expect(preview.getByText("Test delivery street", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print 1 order", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select all orders on this page" }).click();
    await expect(page.getByText("50 selected", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`fulfillment-selection-${width}.png`) });
    await page.getByRole("button", { name: "Print selected orders", exact: true }).click();
    await expect(preview.locator("article.receipt")).toHaveCount(50);
    await expect(page.getByRole("button", { name: "Print 50 orders", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`fulfillment-preview-${width}.png`) });
    const frame = page.frames().find((item) => item.url() === "about:srcdoc")!;
    const printPage = await context.newPage();
    await printPage.setContent(await frame.content());
    await printPage.emulateMedia({ media: "print" });
    expect(
      await printPage
        .locator("article.receipt")
        .nth(1)
        .evaluate((article) => getComputedStyle(article).breakBefore),
    ).toBe("page");
    if (width === 1440) {
      const pdf = await printPage.pdf({
        path: testInfo.outputPath("selected-order-receipts.pdf"),
        preferCSSPageSize: true,
      });
      expect(pdf.toString("latin1")).toMatch(/\/Count 50\b/);
      await printPage
        .locator("article.receipt")
        .first()
        .screenshot({ path: testInfo.outputPath("receipt-print-layout.png") });
    }
    await printPage.close();
    await frame.evaluate(() => {
      (window as unknown as { printed: boolean }).printed = false;
      window.print = () => {
        (window as unknown as { printed: boolean }).printed = true;
      };
    });
    await page.getByRole("button", { name: "Print 50 orders", exact: true }).click();
    expect(await frame.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(
      true,
    );
    expect(detailReads).toBe(51);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Select order FM-PRINT-51 for printing", exact: true }),
    ).not.toBeChecked();
    expect(queries.at(-1)?.get("cursor")).toBe("page-two");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Select all orders on this page" }),
    ).not.toBeChecked();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test("Fulfillment reader without Global Orders access cannot prepare financial receipts", async ({
  page,
}) => {
  await bootstrap(page, false);
  await page.route("**/api/admin/fulfillment?**", (route) =>
    route.fulfill({
      json: { ok: true, requestId: "queue", value: { items: [queueOrder(1)], nextCursor: null } },
    }),
  );
  await page.goto("/admin/fulfillment");
  await page.getByRole("checkbox", { name: "Select all orders on this page" }).click();
  await expect(
    page.getByRole("button", { name: "Print selected orders", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Printing receipts requires Global Orders access.")).toBeVisible();
});
