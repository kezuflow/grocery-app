import type { Page } from "@playwright/test";
import type { AdminSelectedScope } from "@freshmarkets/contracts";
import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    stackUp = (await request.get("/")).status() < 500;
  } catch {
    stackUp = false;
  }
});
async function installPaginationBootstrap(page: Page, selectedScope: AdminSelectedScope) {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-pagination",
      displayName: "Pagination Operator",
      email: "pagination@example.com",
      capabilities: [
        "customers.read",
        "catalog.read",
        "promotions.read",
        "payments.read",
        "procurement.read",
      ],
      scopes:
        selectedScope.kind === "GLOBAL"
          ? [{ kind: "global" }]
          : [{ kind: "location", locationId: "location-cebu-central" }],
      navigation: [
        {
          code: "customers",
          label: "Customers",
          href: "/admin/customers",
          section: "commerce",
          scopeKinds: ["GLOBAL", "MARKET", "LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
        {
          code: "catalog",
          label: "Catalog",
          href: "/admin/catalog",
          section: "commerce",
          scopeKinds: ["GLOBAL", "MARKET", "LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
        {
          code: "promotions",
          label: "Promotion Codes",
          href: "/admin/promotions",
          section: "commerce",
          scopeKinds: ["GLOBAL", "MARKET", "LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
        {
          code: "payments",
          label: "Payments",
          href: "/admin/payments",
          section: "finance",
          scopeKinds: ["GLOBAL", "MARKET", "LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
        {
          code: "procurement",
          label: "Procurement",
          href: "/admin/procurement",
          section: "operations",
          scopeKinds: ["LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
      ],
      environment: "test",
    },
    scopes:
      selectedScope.kind === "GLOBAL"
        ? []
        : [
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
    selectedScope,
    timezone: "Asia/Manila",
  });
}

test.beforeEach(async ({ page }) => {
  test.skip(!stackUp, "Local stack is not running; start web+core to execute E2E flows.");
  await installPaginationBootstrap(page, {
    kind: "LOCATION",
    marketId: "market-metro-cebu",
    locationId: "location-cebu-central",
  });
});

function result(value: unknown) {
  return { ok: true, requestId: "pagination-data", value };
}

async function next(page: Page, index = 0) {
  await page
    .getByRole("navigation", { name: "Results pagination" })
    .nth(index)
    .getByRole("button", { name: "Next" })
    .click();
}

test("customer search reaches its second cursor page without losing the filter", async ({
  page,
}) => {
  await page.route("**/api/admin/customers/invitations**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result({ items: [], nextCursor: null })),
    }),
  );
  await page.route("**/api/admin/customers?**", (route) => {
    const url = new URL(route.request().url());
    const second = url.searchParams.get("cursor") === "customers-next";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        result({
          items: [
            {
              customerId: second ? "customer-2" : "customer-1",
              email: second ? "later@example.com" : "first@example.com",
              accessStatus: "active",
              subscriptionState: null,
              orderCount: 0,
            },
          ],
          nextCursor: second ? null : "customers-next",
        }),
      ),
    });
  });
  await page.goto("/admin/customers");
  await page.getByLabel("Search customers").fill("example.com");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const secondRequestPromise = page.waitForRequest((request) =>
    request.url().includes("cursor=customers-next"),
  );
  await next(page);
  await expect(page.getByText("later@example.com")).toBeVisible();
  const secondRequest = await secondRequestPromise;
  expect(new URL(secondRequest.url()).searchParams.get("query")).toBe("example.com");
});

test("Global promotion list exposes a later cursor record", async ({ page }) => {
  await installPaginationBootstrap(page, { kind: "GLOBAL" });
  const base = {
    code: "FIRST",
    description: "",
    status: "DRAFT",
    benefitType: "ORDER_FIXED_DISCOUNT",
    discountMinor: 100,
    percent: null,
    minimumMinor: 0,
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: null,
    globalUsageLimit: null,
    perCustomerUsageLimit: null,
    automatic: false,
    priority: 0,
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  await page.route("**/api/admin/promotions?**", (route) => {
    const later = new URL(route.request().url()).searchParams.get("cursor") === "promotions-next";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        result({
          items: [
            later
              ? { ...base, promotionId: "promotion-2", code: "LATER", name: "Later promotion" }
              : { ...base, promotionId: "promotion-1", name: "First promotion" },
          ],
          nextCursor: later ? null : "promotions-next",
        }),
      ),
    });
  });
  await page.goto("/admin/promotions");
  await next(page);
  await expect(page.getByText("Later promotion")).toBeVisible();
});

test("finance queue exposes a later cursor record", async ({ adminPage: page }) => {
  const fixtures = [
    {
      path: "/admin/payments",
      api: "/api/admin/payments",
      cursor: "payments-next",
      first: {
        paymentIntentId: "payment-1",
        customerEmail: "first@example.com",
        purpose: "order",
        status: "SUCCEEDED",
        currency: "PHP",
        amountMinor: 100,
        refundedMinor: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      later: {
        paymentIntentId: "payment-2",
        customerEmail: "later-payment@example.com",
        purpose: "order",
        status: "SUCCEEDED",
        currency: "PHP",
        amountMinor: 100,
        refundedMinor: 0,
        createdAt: "2026-08-02T00:00:00.000Z",
      },
      text: "later-payment@example.com",
    },
  ] as const;
  await page.route("**/api/admin/payments/reconciliation**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result({ items: [], nextCursor: null })),
    }),
  );
  for (const fixture of fixtures) {
    await installPaginationBootstrap(page, { kind: "GLOBAL" });
    await page.route(`**${fixture.api}?**`, (route) => {
      const second = new URL(route.request().url()).searchParams.get("cursor") === fixture.cursor;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          result({
            items: [second ? fixture.later : fixture.first],
            nextCursor: second ? null : fixture.cursor,
          }),
        ),
      });
    });
    await page.goto(fixture.path);
    await page.getByRole("button", { name: "Refresh" }).click();
    await next(page);
    await expect(page.getByText(fixture.text)).toBeVisible();
    await page.unroute(`**${fixture.api}?**`);
  }
});
