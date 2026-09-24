import type { Page } from "@playwright/test";
import type { ScheduledWeekView } from "@freshmarkets/contracts";
import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

const locationId = "location-cebu-central";
const cycleA = "cycle-a";
const cycleB = "cycle-b";
const start = Date.parse("2026-09-25T00:00:00.000Z");

async function bootstrap(page: Page, selected: "GLOBAL" | "LOCATION" = "GLOBAL") {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-weeks",
      displayName: "Weeks operator",
      email: "weeks@example.com",
      capabilities: ["procurement.read", "procurement.manage", "fulfillment.read"],
      scopes: [{ kind: "global" }, { kind: "location", locationId }],
      navigation: [
        {
          code: "overview",
          label: "Home",
          href: "/admin",
          section: "home",
          scopeKinds: ["GLOBAL", "MARKET", "LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
        {
          code: "procurement",
          label: "Delivery weeks",
          href: "/admin/procurement",
          section: "orders",
          scopeKinds: ["GLOBAL", "LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
      ],
      environment: "test",
    },
    scopes: [
      {
        kind: "location",
        marketId: "market-cebu",
        marketCode: "CEBU",
        locationId,
        locationCode: "CENTRAL",
        locationName: "Central Cebu",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
    ],
    selectedScope:
      selected === "GLOBAL"
        ? { kind: "GLOBAL" }
        : {
            kind: "LOCATION",
            marketId: "market-cebu",
            locationId,
          },
    timezone: "Asia/Manila",
  });
}

function week(cycleId: string, section: string): ScheduledWeekView {
  const page: ScheduledWeekView["page"] =
    section === "DEMAND"
      ? { kind: "DEMAND", items: [], nextCursor: null }
      : section === "ORDERS"
        ? {
            kind: "ORDERS",
            denied: false,
            nextCursor: null,
            requirement: {
              id: "requirement-a",
              productName: "Carrots",
              variantName: "1 kg",
              baseUnit: "GRAM",
            },
            items: [
              {
                orderId: "order-a",
                status: "COMMITTED",
                preparationStatus: null,
                openQuantityBase: 1000,
                cancellationStatus: null,
              },
            ],
          }
        : section === "OFFERS"
          ? { kind: "OFFERS", items: [], nextCursor: null }
          : {
              kind: "ORDER_SUMMARY",
              items: [],
              nextCursor: null,
              totals: {
                paidOrderCount: 0,
                productCount: 0,
                sellingOptionCount: 0,
                destinationCount: 0,
              },
            };
  return {
    cycles: [
      { cycleId: cycleA, name: "September delivery", status: "CUTOFF_REACHED" },
      { cycleId: cycleB, name: "October delivery", status: "DRAFT" },
    ],
    nextCycleCursor: null,
    week: cycleId
      ? {
          cycleId,
          name: cycleId === cycleA ? "September delivery" : "October delivery",
          status: cycleId === cycleA ? "CUTOFF_REACHED" : "DRAFT",
          timezone: "Asia/Manila",
          orderOpensAt: start - 86400000,
          cutoffAt: start - 3600000,
          procurementAt: start,
          preparationAt: start + 3600000,
          pickupAt: start + 7200000,
          purchaseBlockedReason: null,
          windows: [
            { name: "Customer delivery", startsAt: start + 10800000, endsAt: start + 18000000 },
          ],
        }
      : null,
    page,
  };
}

function success(value: ScheduledWeekView) {
  return { ok: true, requestId: "week-e2e", value };
}

let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    stackUp = (await request.get("/")).status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async () => {
  test.skip(!stackUp, "Local stack is not running; start Web/Core for desktop acceptance.");
});

test("desktop week prioritizes customer arrival and preserves its card during section reads", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrap(page);
  const delayed: { release?: () => void } = {};
  await page.route("**/api/admin/procurement/week?**", async (route) => {
    const url = new URL(route.request().url());
    const section = url.searchParams.get("section") ?? "ORDER_SUMMARY";
    if (section === "DEMAND")
      await new Promise<void>((resolve) => {
        delayed.release = resolve;
      });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(success(week(url.searchParams.get("cycleId") ?? "", section))),
    });
  });
  await page.goto("/admin/procurement");
  await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(cycleA);
  const dates = page.getByRole("region", { name: "Delivery week dates" });
  await expect(dates.getByText("Customer arrival")).toBeVisible();
  await expect(dates.getByText("Operational schedule")).toBeVisible();
  await expect(dates.getByText("Asia/Manila")).toBeVisible();
  await expect(page.getByRole("button", { name: "Order summary" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Paid orders" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("delivery-week-1440.png"), fullPage: true });
  await page.getByRole("button", { name: "Quantities to buy" }).click();
  await expect(dates.getByText("Customer arrival")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Loading quantities to buy");
  delayed.release?.();
  await expect(page.getByRole("heading", { name: "Quantities to buy" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Results pagination" })).toContainText(
    "Page 1",
  );
});

test("location scope exposes all sections and a new cycle returns to Order summary", async ({
  page,
}) => {
  await bootstrap(page, "LOCATION");
  await page.route("**/api/admin/procurement/week?**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        success(
          week(
            url.searchParams.get("cycleId") ?? "",
            url.searchParams.get("section") ?? "ORDER_SUMMARY",
          ),
        ),
      ),
    });
  });
  await page.goto("/admin/procurement");
  await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(cycleA);
  await expect(page.getByRole("button", { name: "Paid orders" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Offered products" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Receiving" })).toHaveAttribute(
    "href",
    `/admin/receiving?cycleId=${cycleA}`,
  );
  await page.getByRole("button", { name: "Paid orders" }).click();
  await expect(page.getByRole("heading", { name: "Paid orders" })).toBeVisible();
  await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(cycleB);
  await expect(page.getByRole("button", { name: "Order summary" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Order summary" })).toBeVisible();
});

test("requirement deep link opens Paid orders and read failure offers a retry", async ({
  page,
}) => {
  await bootstrap(page, "LOCATION");
  let fail = true;
  await page.route("**/api/admin/procurement/week?**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        fail
          ? {
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                message: "Week temporarily unavailable",
                requestId: "week",
              },
            }
          : success(
              week(
                url.searchParams.get("cycleId") ?? "",
                url.searchParams.get("section") ?? "ORDER_SUMMARY",
              ),
            ),
      ),
    });
  });
  await page.goto(
    `/admin/procurement?cycleId=${cycleA}&locationId=${locationId}&requirementId=requirement-a`,
  );
  await expect(page.getByRole("alert")).toContainText("Week temporarily unavailable");
  fail = false;
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("heading", { name: "Paid orders" })).toBeVisible();
  await expect(page.getByText("Affected orders: Carrots")).toBeVisible();
  await expect(page.getByRole("button", { name: "Paid orders" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("scope change hides a prior week while its section read is in flight", async ({ page }) => {
  await bootstrap(page);
  const delayed: { release?: () => void } = {};
  await page.route("**/api/admin/procurement/week?**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("locationId") && url.searchParams.get("section") === "DEMAND") {
      await new Promise<void>((resolve) => {
        delayed.release = resolve;
      });
    }
    try {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          success(
            week(
              url.searchParams.get("cycleId") ?? "",
              url.searchParams.get("section") ?? "ORDER_SUMMARY",
            ),
          ),
        ),
      });
    } catch {
      // Scope change cancels the superseded request.
    }
  });
  await page.goto("/admin/procurement");
  await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(cycleA);
  await expect(page.getByRole("region", { name: "Delivery week dates" })).toBeVisible();
  await page.getByRole("button", { name: "Quantities to buy" }).click();
  await expect.poll(() => Boolean(delayed.release)).toBe(true);
  await page.getByRole("combobox", { name: "Active admin scope" }).click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(page.getByRole("region", { name: "Delivery week dates" })).toHaveCount(0);
  delayed.release?.();
  await expect(page.getByRole("combobox", { name: "Delivery week", exact: true })).toHaveValue("");
  await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(cycleA);
  await expect(page.getByRole("button", { name: "Order summary" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("region", { name: "Delivery week dates" })).toBeVisible();
});

test("uncertain purchase blocks Back and confirmed purchase suppresses stale action after read failure", async ({
  page,
}) => {
  await bootstrap(page, "LOCATION");
  const item = {
    locationId,
    locationName: "Central Cebu",
    totalQuantityBase: 1500,
    totalQuantitySellable: 3,
    skuId: "sku-juice",
    inventoryPoolId: "pool-juice",
    productName: "Juice",
    variantName: "500 mL",
    quantitySellable: 3,
    quantityBase: 1500,
    baseUnit: "MILLILITER",
    shippingGrams: 1800,
    requirementId: "requirement-juice",
    requirementVersion: 2,
    status: "NEEDS_PURCHASE",
    acceptedBase: 0,
    rejectedBase: 0,
    shortageBase: 0,
    replacementBase: 0,
    receivingStatus: null,
    canConfirmPurchase: true,
  };
  let purchased = false;
  const attempts: { body: string | null; key: string | undefined }[] = [];
  await page.route("**/api/admin/procurement/week?**", (route) => {
    const url = new URL(route.request().url());
    const section = url.searchParams.get("section") ?? "ORDER_SUMMARY";
    const value = week(url.searchParams.get("cycleId") ?? "", section);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        purchased && section === "DEMAND"
          ? { ok: false, error: { message: "Readback temporarily unavailable" } }
          : success(
              section === "DEMAND"
                ? { ...value, page: { kind: "DEMAND", items: [item], nextCursor: null } }
                : value,
            ),
      ),
    });
  });
  await page.route("**/api/admin/procurement/purchase", (route) => {
    attempts.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    if (attempts.length === 1) return route.abort("failed");
    purchased = true;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: {} }),
    });
  });
  await page.goto("/admin/procurement");
  await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(cycleA);
  await page.getByRole("button", { name: "Quantities to buy" }).click();
  await expect(page.getByText("1,500 mL")).toBeVisible();
  await page.getByRole("button", { name: "Confirm purchase", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Confirm purchase", exact: true }).click();
  await expect(
    sheet.getByText("The action could not be confirmed.", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/\/admin\/procurement$/);
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Confirm purchase", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByRole("alert")).toContainText("Readback temporarily unavailable");
  await expect(page.getByText("Purchase recorded. Refreshing current quantities.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm purchase", exact: true })).toHaveCount(0);
});
