import type { Page } from "@playwright/test";
import { expect, test } from "./admin-authenticated-fixture";

let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    stackUp = (await request.get("/")).status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async ({ page }) => {
  test.skip(!stackUp, "Local stack is not running; start web+core to execute E2E flows.");
  await page.route("**/api/admin/context", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "pagination-context",
        value: {
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
          scopes: [{ kind: "location", locationId: "location-cebu-central" }],
          navigation: [
            { code: "customers", label: "Customers", href: "/admin/customers" },
            { code: "catalog", label: "Catalog", href: "/admin/catalog" },
            { code: "promotions", label: "Promotions", href: "/admin/promotions" },
            { code: "payments", label: "Payments", href: "/admin/payments" },
            { code: "procurement", label: "Procurement", href: "/admin/procurement" },
          ],
          environment: "test",
        },
      }),
    }),
  );
  await page.route("**/api/admin/scopes", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "pagination-scopes",
        value: [
          {
            kind: "location",
            marketId: "market-metro-cebu",
            marketCode: "CEBU",
            locationId: "location-cebu-central",
            locationCode: "CENTRAL",
            locationName: "Cebu Central",
            currency: "PHP",
            timezone: "Asia/Manila",
          },
        ],
      }),
    }),
  );
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
  await page.getByLabel("Search by email").fill("example.com");
  await page.getByRole("button", { name: "Search" }).click();
  const secondRequestPromise = page.waitForRequest((request) =>
    request.url().includes("cursor=customers-next"),
  );
  await next(page, 1);
  await expect(page.getByText("later@example.com")).toBeVisible();
  const secondRequest = await secondRequestPromise;
  expect(new URL(secondRequest.url()).searchParams.get("query")).toBe("example.com");
});

test("promotion, catalog, finance, and operations queues expose later cursor records", async ({
  page,
}) => {
  const fixtures = [
    {
      path: "/admin/promotions",
      api: "/api/admin/promotions",
      cursor: "promotions-next",
      first: {
        promotionId: "promotion-1",
        code: "FIRST",
        name: "First",
        status: "DRAFT",
        benefitType: "ORDER_FIXED_DISCOUNT",
        discountMinor: 100,
        percent: null,
      },
      later: {
        promotionId: "promotion-2",
        code: "LATER",
        name: "Later promotion",
        status: "DRAFT",
        benefitType: "ORDER_FIXED_DISCOUNT",
        discountMinor: 100,
        percent: null,
      },
      text: "Later promotion",
    },
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
    await next(page);
    await expect(page.getByText(fixture.text)).toBeVisible();
    await page.unroute(`**${fixture.api}?**`);
  }

  await page.route("**/api/admin/catalog/categories**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result({ items: [], nextCursor: null })),
    }),
  );
  await page.route("**/api/admin/catalog/units**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(result([])) }),
  );
  await page.route("**/api/admin/catalog/products?**", (route) => {
    const second = new URL(route.request().url()).searchParams.get("cursor") === "catalog-next";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        result({
          items: [
            {
              productId: second ? "product-2" : "product-1",
              name: second ? "Later product" : "First product",
              categoryCode: "PRODUCE",
              status: "active",
              skuCount: 1,
            },
          ],
          nextCursor: second ? null : "catalog-next",
        }),
      ),
    });
  });
  await page.goto("/admin/catalog");
  await next(page, 1);
  await expect(page.getByText("Later product")).toBeVisible();

  await page.route("**/api/admin/procurement?**", (route) => {
    const second = new URL(route.request().url()).searchParams.get("cursor") === "procurement-next";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        result({
          items: [
            {
              requirementId: second ? "requirement-later" : "requirement-first",
              cycleId: "cycle-1",
              requiredQuantityBase: 10,
              acceptedBase: 0,
              rejectedBase: 0,
              status: "AGGREGATED",
              version: 1,
            },
          ],
          nextCursor: second ? null : "procurement-next",
        }),
      ),
    });
  });
  await page.goto("/admin/procurement");
  await next(page);
  await expect(page.getByText("requirement-later")).toBeVisible();
});
