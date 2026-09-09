import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get("/");
    stackUp = response.status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async () => {
  test.skip(!stackUp, "Local stack is not running; start web+core to execute E2E flows.");
});

test("Analytics workspace renders numeric and unavailable Core values", async ({ page }) => {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-analytics",
      displayName: "Analytics Operator",
      email: "analytics@example.com",
      capabilities: ["analytics.read"],
      scopes: [{ kind: "global" }],
      navigation: [
        {
          code: "analytics",
          label: "Analytics",
          href: "/admin/analytics",
          section: "finance",
          scopeKinds: ["GLOBAL", "MARKET", "LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
      ],
      environment: "test",
    },
    scopes: [
      {
        kind: "location",
        marketId: "market-metro-cebu",
        marketCode: "CEBU",
        locationId: "location-cebu-central",
        locationCode: "CENTRAL",
        locationName: "Central Cebu",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
    ],
    selectedScope: { kind: "GLOBAL" },
    timezone: "Asia/Manila",
  });
  await page.route("**/api/admin/analytics/definitions**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "analytics-e2e",
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
              sourceWatermark: "2026-08-29T00:00:00.000Z",
              computedAt: "2026-08-29T00:01:00.000Z",
            },
            approvedAt: "2026-08-01T00:00:00.000Z",
          },
          {
            code: "refund_amount",
            version: 1,
            displayName: "Money refunded",
            category: "FINANCE",
            formulaDescription: "Successful refunds by first confirmation date.",
            availability: "UNAVAILABLE",
            unavailableReason: "Retained refund confirmation dates are unavailable.",
            dimensions: ["currency"],
            freshness: null,
            approvedAt: null,
          },
        ],
      }),
    }),
  );
  await page.route("**/api/admin/analytics/overview**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "analytics-e2e",
        value: {
          window: {
            startAt: "2026-07-30T00:00:00.000Z",
            endAt: "2026-08-29T00:00:00.000Z",
            timezone: "Asia/Manila",
          },
          scope: { kind: "global" },
          definitions: [{ metricCode: "order_count", definitionVersion: 1 }],
          productOptions: {
            items: [{ skuId: "sku-report", productName: "Red Onion", optionName: "500 g" }],
            nextCursor: null,
          },
          freshness: {
            sourceWatermark: "2026-08-29T00:00:00.000Z",
            computedAt: "2026-08-29T00:01:00.000Z",
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
              metricCode: "refund_amount",
              definitionVersion: 1,
              availability: "UNAVAILABLE",
              value: null,
              unavailableReason: "Retained refund confirmation dates are unavailable.",
              dimensions: [{ key: "currency", value: "PHP" }],
            },
          ],
        },
      }),
    }),
  );

  await page.goto("/admin/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByText("42", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Retained refund confirmation dates are unavailable.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Timezone", exact: true })).toHaveValue(
    "Asia/Manila",
  );
  const dimensionedRequest = page.waitForRequest((request) => {
    if (!request.url().includes("/api/admin/analytics/overview")) return false;
    const dimensions = new URL(request.url()).searchParams.get("dimensions");
    if (!dimensions) return false;
    const parsed = JSON.parse(dimensions) as Array<{ key: string; value: string }>;
    return (
      parsed.some(({ key, value }) => key === "currency" && value === "PHP") &&
      parsed.some(({ key, value }) => key === "skuId" && value === "sku-report")
    );
  });
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("PHP");
  await page
    .getByRole("combobox", { name: "Product selling option", exact: true })
    .selectOption("sku-report");
  await dimensionedRequest;
});

test("a provisioned Staff reader opens the real Analytics workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/analytics");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
});

test("a Staff principal without capability is denied the Analytics workspace", async ({
  deniedAdminPage,
}) => {
  await deniedAdminPage.goto("/admin/analytics");
  await expect(deniedAdminPage.getByRole("alert")).toContainText(
    /analytics\.read.*required|requires.*analytics\.read/i,
  );
});
