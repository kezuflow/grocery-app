import type { Page } from "@playwright/test";
import { expect, test } from "./admin-authenticated-fixture";

const viewports = [
  { name: "desktop", width: 1440, height: 1200 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "mobile", width: 390, height: 844 },
] as const;

let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    stackUp = (await request.get("/")).status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async () => {
  test.skip(!stackUp, "Local stack is not running; start web+core to execute visual regression.");
});

function json(value: unknown) {
  return { contentType: "application/json", body: JSON.stringify(value) };
}

async function installDeterministicReads(page: Page) {
  await page.clock.setFixedTime(new Date("2026-08-31T08:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/admin/overview?**", (route) =>
    route.fulfill(
      json({
        ok: true,
        requestId: "visual-overview",
        value: {
          generatedAt: "2026-08-31T08:00:00.000Z",
          selectedScope: { kind: "GLOBAL" },
          timezone: "Asia/Manila",
          cards: [
            {
              code: "OPEN_ORDERS",
              label: "Open orders",
              value: 18,
              unavailableReason: null,
              href: "/admin/orders",
            },
            {
              code: "PAYMENT_ACTION",
              label: "Payments requiring action",
              value: 3,
              unavailableReason: null,
              href: "/admin/payments",
            },
            {
              code: "OPEN_EXCEPTIONS",
              label: "Open exceptions",
              value: 5,
              unavailableReason: null,
              href: "/admin/issues/operational-exceptions",
            },
            {
              code: "ACTIVE_PRODUCTS",
              label: "Active products",
              value: 226,
              unavailableReason: null,
              href: "/admin/catalog/products",
            },
          ],
          workloadStages: [
            { code: "COMMITTED", label: "Committed", count: 8 },
            { code: "PICKING", label: "Picking", count: 6 },
            { code: "READY", label: "Ready", count: 4 },
          ],
          exceptions: [
            {
              kind: "FULFILLMENT_SHORTAGE",
              source: "FULFILLMENT",
              severity: "HIGH",
              ageMinutes: 30,
              ownerId: null,
              referenceId: "exception-1",
              orderId: "order-1042",
              locationId: "location-cebu-central",
              reason: "Required base units unavailable",
              permittedActions: ["ALTERNATE_SOURCE", "ESCALATE"],
              detail: "Order order-1042 requires an alternate source.",
              href: "/admin/issues/operational-exceptions",
            },
            {
              kind: "DELIVERY_FAILED",
              source: "DELIVERY",
              severity: "MEDIUM",
              ageMinutes: 60,
              ownerId: "staff-dispatch",
              referenceId: "exception-2",
              orderId: "order-1041",
              locationId: "location-cebu-central",
              reason: "Recipient unavailable",
              permittedActions: ["RETRY_DELIVERY", "RESCHEDULE"],
              detail: "Delivery retry decision is required.",
              href: "/admin/issues/operational-exceptions",
            },
          ],
          recentOperations: [
            {
              auditEventId: "audit-1",
              action: "ORDER.COMMITTED",
              resourceType: "order",
              resourceId: "order-1042",
              occurredAt: "2026-08-31T07:45:00.000Z",
              actorId: null,
              marketId: "market-metro-cebu",
              locationId: "location-cebu-central",
              reason: null,
              correlationId: "request-1042",
            },
          ],
          freshness: {
            computedAt: "2026-08-31T08:00:00.000Z",
            sourceWatermark: "2026-08-31T07:59:00.000Z",
          },
          deniedSections: [],
        },
      }),
    ),
  );
  await page.route("**/api/admin/orders?**", (route) =>
    route.fulfill(
      json({
        ok: true,
        requestId: "visual-orders",
        value: {
          items: [
            {
              orderId: "order-1042",
              customerEmail: "maria@example.com",
              status: "COMMITTED",
              totalMinor: 245_500,
              currency: "PHP",
              paymentStatus: "SUCCEEDED",
              fulfillmentStatus: "PICKING",
              deliveryStatus: null,
              committedAt: "2026-08-31T07:45:00.000Z",
              version: 3,
            },
            {
              orderId: "order-1041",
              customerEmail: "jose@example.com",
              status: "FULFILLMENT_PENDING",
              totalMinor: 189_000,
              currency: "PHP",
              paymentStatus: "SUCCEEDED",
              fulfillmentStatus: "READY",
              deliveryStatus: "UNASSIGNED",
              committedAt: "2026-08-31T07:15:00.000Z",
              version: 5,
            },
          ],
          nextCursor: null,
        },
      }),
    ),
  );
  await page.route("**/api/admin/analytics/definitions?**", (route) =>
    route.fulfill(
      json({
        ok: true,
        requestId: "visual-analytics",
        value: [
          {
            code: "order_count",
            version: 1,
            displayName: "Order count",
            category: "ORDERS",
            formulaDescription: "Committed orders in the selected window.",
            availability: "AVAILABLE",
            unavailableReason: null,
            dimensions: [],
            freshness: {
              sourceWatermark: "2026-08-31T07:59:00.000Z",
              computedAt: "2026-08-31T08:00:00.000Z",
            },
            approvedAt: "2026-08-01T00:00:00.000Z",
          },
          {
            code: "aov",
            version: 1,
            displayName: "Average order value",
            category: "FINANCE",
            formulaDescription: "Unavailable until accounting policy is approved.",
            availability: "UNAVAILABLE",
            unavailableReason: "ACCOUNTING_POLICY_UNRESOLVED",
            dimensions: ["currency"],
            freshness: null,
            approvedAt: null,
          },
        ],
      }),
    ),
  );
  await page.route("**/api/admin/analytics/overview?**", (route) =>
    route.fulfill(
      json({
        ok: true,
        requestId: "visual-analytics",
        value: {
          window: {
            startAt: "2026-08-01T08:00:00.000Z",
            endAt: "2026-08-31T08:00:00.000Z",
            timezone: "Asia/Manila",
          },
          scope: { kind: "global" },
          definitions: [{ metricCode: "order_count", definitionVersion: 1 }],
          freshness: {
            sourceWatermark: "2026-08-31T07:59:00.000Z",
            computedAt: "2026-08-31T08:00:00.000Z",
          },
          metrics: [
            {
              metricCode: "order_count",
              definitionVersion: 1,
              availability: "AVAILABLE",
              value: 42,
              unavailableReason: null,
              dimensions: [],
            },
            {
              metricCode: "aov",
              definitionVersion: 1,
              availability: "UNAVAILABLE",
              value: null,
              unavailableReason: "ACCOUNTING_POLICY_UNRESOLVED",
              dimensions: [{ key: "currency", value: "PHP" }],
            },
          ],
        },
      }),
    ),
  );
  await page.route("**/api/admin/analytics/metrics/**", (route) =>
    route.fulfill(
      json({
        ok: true,
        requestId: "visual-series",
        value: {
          metricCode: "order_count",
          definitionVersion: 1,
          window: {
            startAt: "2026-08-01T08:00:00.000Z",
            endAt: "2026-08-31T08:00:00.000Z",
            timezone: "Asia/Manila",
          },
          dimensions: [],
          availability: "AVAILABLE",
          unavailableReason: null,
          freshness: {
            sourceWatermark: "2026-08-31T07:59:00.000Z",
            computedAt: "2026-08-31T08:00:00.000Z",
          },
          points: [
            { occurredAt: "2026-08-01T00:00:00.000Z", value: 9 },
            { occurredAt: "2026-08-08T00:00:00.000Z", value: 14 },
            { occurredAt: "2026-08-15T00:00:00.000Z", value: 11 },
            { occurredAt: "2026-08-22T00:00:00.000Z", value: 18 },
          ],
        },
      }),
    ),
  );
  await page.route("**/api/admin/commerce-configuration/membership-price", (route) =>
    route.fulfill(
      json({
        ok: true,
        requestId: "visual-price",
        value: {
          priceVersionId: "price-v7",
          offerId: "membership-global",
          amountMinor: 29_900,
          currency: "PHP",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          version: 7,
        },
      }),
    ),
  );
  await page.route("**/api/admin/commerce-configuration/service-fee", (route) =>
    route.fulfill(
      json({
        ok: true,
        requestId: "visual-fee",
        value: {
          configurationId: "fee-v4",
          feeType: "MIXED",
          flatMinor: 1_500,
          percentageBasisPoints: 250,
          currency: "PHP",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          version: 4,
          reason: "Approved fee review",
        },
      }),
    ),
  );
}

async function capture(page: Page, route: string, heading: string, name: string) {
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });
}

for (const viewport of viewports) {
  test(`shared Admin archetypes match ${viewport.name} baselines`, async ({ adminPage }) => {
    await adminPage.setViewportSize({ width: viewport.width, height: viewport.height });
    await installDeterministicReads(adminPage);
    await capture(adminPage, "/admin", "Overview", `overview-${viewport.name}.png`);
    await capture(
      adminPage,
      "/admin/catalog/products?query=abiu",
      "Products",
      `product-list-${viewport.name}.png`,
    );
    await capture(
      adminPage,
      "/admin/catalog/products/product-abiu",
      "Abiu",
      `product-detail-${viewport.name}.png`,
    );
    await capture(
      adminPage,
      "/admin/catalog/products/new",
      "Add product",
      `product-editor-${viewport.name}.png`,
    );
    await capture(adminPage, "/admin/orders", "Orders", `transaction-list-${viewport.name}.png`);
    await capture(adminPage, "/admin/analytics", "Analytics", `analytics-${viewport.name}.png`);
    await capture(
      adminPage,
      "/admin/settings/fulfillment-mode",
      "Fulfillment mode",
      `settings-${viewport.name}.png`,
    );
    await capture(
      adminPage,
      "/admin/commerce-configuration",
      "Pricing & fees",
      `commerce-configuration-${viewport.name}.png`,
    );
  });
}
