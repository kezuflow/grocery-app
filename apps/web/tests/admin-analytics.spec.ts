import { expect, test } from "@playwright/test";

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
  await page.route("**/api/admin/context", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "analytics-e2e",
        value: {
          staffId: "staff-analytics",
          displayName: "Analytics Operator",
          email: "analytics@example.com",
          capabilities: ["analytics.read"],
          scopes: [{ kind: "global" }],
          navigation: [{ code: "analytics", label: "Analytics", href: "/admin/analytics" }],
          environment: "test",
        },
      }),
    }),
  );
  await page.route("**/api/admin/scopes", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, requestId: "analytics-e2e", value: [] }),
    }),
  );
  await page.route("**/api/admin/analytics/definitions", (route) =>
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
            code: "aov",
            version: 1,
            displayName: "Average order value",
            category: "FINANCE",
            formulaDescription: "Unavailable until the canonical accounting policy is resolved.",
            availability: "UNAVAILABLE",
            unavailableReason: "ACCOUNTING_POLICY_UNRESOLVED",
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
    }),
  );

  await page.goto("/admin/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByText("42", { exact: true })).toBeVisible();
  await expect(
    page.getByText("ACCOUNTING_POLICY_UNRESOLVED", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Source freshness", { exact: true })).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
});
