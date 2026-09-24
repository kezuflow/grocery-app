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

test("Analytics workspace renders numeric and unavailable Core values", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
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
      {
        kind: "location",
        marketId: "market-report-utc",
        marketCode: "REPORT",
        locationId: "location-report-utc",
        locationCode: "UTC",
        locationName: "UTC report location",
        currency: "PHP",
        timezone: "UTC",
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
  let holdChangedPeriod = false;
  let changedPeriod = false;
  let releasePeriod!: () => void;
  const heldPeriod = new Promise<void>((resolve) => (releasePeriod = resolve));
  await page.route("**/api/admin/analytics/overview**", async (route) => {
    if (holdChangedPeriod) {
      holdChangedPeriod = false;
      await heldPeriod;
    }
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "analytics-e2e",
        value: {
          window: {
            startAt: query.get("startAt"),
            endAt: query.get("endAt"),
            timezone: query.get("timezone"),
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
              value: changedPeriod ? 77 : 42,
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
    });
  });

  await page.clock.setFixedTime(new Date("2026-09-24T17:00:00Z"));
  await page.goto("/admin/analytics");
  await expect(page.getByText("Select a reporting timezone.")).toBeVisible();
  await page.getByRole("combobox", { name: "Timezone", exact: true }).selectOption("UTC");
  await expect(page.getByLabel("Through")).toHaveValue("2026-09-24");
  await page.getByRole("combobox", { name: "Timezone", exact: true }).selectOption("Asia/Manila");
  await expect(page.getByLabel("Through")).toHaveValue("2026-09-25");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByText("42", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Retained refund confirmation dates are unavailable.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Timezone", exact: true })).toHaveValue(
    "Asia/Manila",
  );
  await page.screenshot({ path: testInfo.outputPath("analytics-1440.png"), fullPage: true });
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
  await page.getByText("Product breakdown", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Product selling option", exact: true })
    .selectOption("sku-report");
  await dimensionedRequest;
  await page.getByLabel("Through").fill("2026-09-03");
  await expect(page.getByText("42", { exact: true })).toBeVisible();
  holdChangedPeriod = true;
  changedPeriod = true;
  const nextRequest = page.waitForRequest(
    (request) =>
      request.url().includes("/api/admin/analytics/overview") &&
      new URL(request.url()).searchParams.get("startAt") === "2026-08-31T16:00:00Z",
  );
  await page.getByLabel("From").fill("2026-09-01");
  const request = await nextRequest;
  expect(new URL(request.url()).searchParams.get("endAt")).toBe("2026-09-03T16:00:00Z");
  await expect(page.getByRole("status", { name: "Loading Analytics" })).toBeVisible();
  await expect(page.getByText("42", { exact: true })).toHaveCount(0);
  releasePeriod();
  await expect(page.getByText("77", { exact: true })).toBeVisible();
  await expect(page.getByText(/2026-09-01 through 2026-09-03/)).toBeVisible();
  const utcRequest = page.waitForRequest(
    (request) =>
      request.url().includes("/api/admin/analytics/overview") &&
      new URL(request.url()).searchParams.get("timezone") === "UTC",
  );
  await page.getByRole("combobox", { name: "Timezone", exact: true }).selectOption("UTC");
  const utcQuery = new URL((await utcRequest).url()).searchParams;
  expect(utcQuery.get("startAt")).toBe("2026-09-01T00:00:00Z");
  expect(utcQuery.get("endAt")).toBe("2026-09-04T00:00:00Z");
  await expect(page.getByText(/2026-09-01 through 2026-09-03 · Global · UTC/)).toBeVisible();
});

test("Analytics clears prior scope and currency figures before the next report", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const freshness = { sourceWatermark: null, computedAt: "2026-09-25T00:01:00.000Z" };
  const definitions = [
    {
      code: "order_count",
      version: 1,
      displayName: "Order count",
      category: "ORDERS",
      formulaDescription: "Committed orders in the selected window.",
      valueUnit: "COUNT",
      availability: "AVAILABLE",
      unavailableReason: null,
      dimensions: [],
      freshness,
      approvedAt: freshness.computedAt,
    },
    {
      code: "received_money",
      version: 1,
      displayName: "Money received",
      category: "FINANCE",
      formulaDescription: "Confirmed received money.",
      valueUnit: "MINOR_UNITS",
      availability: "AVAILABLE",
      unavailableReason: null,
      dimensions: ["currency"],
      freshness,
      approvedAt: freshness.computedAt,
    },
  ];
  await page.route("**/api/admin/analytics/definitions**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: definitions }),
    }),
  );
  let holdLocation = true;
  let locationStarted = false;
  let releaseLocation!: () => void;
  const heldLocation = new Promise<void>((resolve) => (releaseLocation = resolve));
  await page.route("**/api/admin/analytics/overview**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const location = query.get("scopeKind") === "LOCATION";
    if (location && holdLocation) {
      holdLocation = false;
      locationStarted = true;
      await heldLocation;
    }
    const dimensions = JSON.parse(query.get("dimensions") ?? "[]") as Array<{
      key: string;
      value: string;
    }>;
    const currency = dimensions.find((item) => item.key === "currency")?.value;
    const metrics = [
      {
        metricCode: "order_count",
        definitionVersion: 1,
        availability: "AVAILABLE",
        value: location ? 20 : 10,
        unavailableReason: null,
        dimensions: [],
      },
      {
        metricCode: "received_money",
        definitionVersion: 1,
        availability: currency ? "AVAILABLE" : "UNAVAILABLE",
        value: currency ? 12500 : null,
        unavailableReason: currency ? null : "Select one currency.",
        dimensions: currency ? [{ key: "currency", value: currency }] : [],
      },
    ];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          window: {
            startAt: query.get("startAt"),
            endAt: query.get("endAt"),
            timezone: query.get("timezone"),
          },
          scope: location
            ? { kind: "location", locationId: query.get("locationId") }
            : { kind: "global" },
          definitions: definitions.map((item) => ({
            metricCode: item.code,
            definitionVersion: item.version,
          })),
          productOptions: { items: [], nextCursor: null },
          freshness,
          metrics,
        },
      }),
    });
  });
  await page.goto("/admin/analytics");
  await expect(page.getByText("10", { exact: true })).toBeVisible();
  const scope = page.getByRole("combobox", { name: "Active admin scope" });
  await scope.click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect.poll(() => locationStarted).toBe(true);
  await expect(page.getByRole("status", { name: "Loading Analytics" })).toBeVisible();
  await expect(page.getByText("10", { exact: true })).toHaveCount(0);
  releaseLocation();
  await expect(page.getByText("20", { exact: true })).toBeVisible();
  await expect(page.getByText(/Scope: Central Cebu/)).toBeVisible();
  await expect(page.getByText("₱125.00", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("");
  await expect(page.getByText("₱125.00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Select one currency.", { exact: true })).toBeVisible();
  await expect(page.getByText("20", { exact: true })).toBeVisible();
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
