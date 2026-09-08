import { expect, test } from "@playwright/test";
import type {
  AdminProductDetail,
  AdminContextView,
  AdminScopeOptionView,
  AdminSkuPricesView,
} from "@freshmarkets/contracts";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

// Browser rendering/interaction with controlled RPC responses; not live D1 acceptance.
const product: AdminProductDetail = {
  productId: "price-product",
  categoryId: "vegetables",
  slug: "onion",
  name: "Onion",
  description: null,
  categoryCode: "VEGETABLES",
  categoryName: "Vegetables",
  status: "active",
  version: 1,
  customerDetails: [],
  media: [],
  recentAudit: [],
  allowedActions: [],
  scope: { kind: "GLOBAL" },
  inventoryPool: {
    inventoryPoolId: "pool-1",
    baseUnitId: "unit-gram",
    baseUnitCode: "GRAM",
    baseUnitSymbol: "g",
    position: null,
  },
  skus: [
    {
      skuId: "sku-1",
      code: "ONION_500G",
      name: "500 g",
      merchandisingLabel: null,
      unitSymbol: "g",
      sellQuantity: 500,
      consumptionBaseQuantity: 500,
      estimatedShippingWeightGrams: 500,
      status: "active",
      sortOrder: 1,
      version: 1,
      priceMinor: null,
      priceVersion: null,
      currency: null,
      availability: null,
      availabilityVersion: null,
    },
  ],
};
const context: AdminContextView = {
  staffId: "staff-1",
  displayName: "Price manager",
  email: "price-manager@example.test",
  capabilities: ["catalog.read", "prices.read", "prices.manage"],
  scopes: [{ kind: "global" }],
  environment: "test",
  navigation: [],
};
const scopes: AdminScopeOptionView[] = [
  {
    kind: "location",
    locationId: "location-1",
    locationCode: "CEBU",
    locationName: "Cebu",
    marketId: "market-1",
    marketCode: "CEBU",
    currency: "PHP",
    timezone: "Asia/Manila",
  },
];
const initialPrices: AdminSkuPricesView = {
  skuId: "sku-1",
  locationId: "location-1",
  marketId: "market-1",
  currency: "PHP",
  currentPriceMinor: null,
  latestVersion: 0,
  canManage: true,
  history: [],
};

for (const width of [1440, 390]) {
  test(`Global exact-location price editor at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let saved = false;
    let local = false;
    let command: Record<string, unknown> | null = null;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let value: unknown;
      if (path.endsWith("/products/price-product"))
        value = local
          ? {
              ...product,
              scope: {
                kind: "LOCATION",
                marketId: "market-1",
                marketName: "Cebu",
                locationId: "location-1",
                locationName: "Cebu",
                currency: "PHP",
              },
            }
          : product;
      else if (path.endsWith("/units")) value = [];
      else if (path.endsWith("/prices"))
        value = saved
          ? {
              ...initialPrices,
              currentPriceMinor: 2550,
              latestVersion: 1,
              history: [
                {
                  amountMinor: 2550,
                  currency: "PHP",
                  version: 1,
                  validFrom: Date.now(),
                  validTo: null,
                },
              ],
            }
          : initialPrices;
      else if (path.endsWith("/price")) {
        command = route.request().postDataJSON();
        saved = true;
        value = product.skus[0];
      } else {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { code: "NOT_FOUND", message: "No test route", requestId: "browser" },
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, value, requestId: "browser" }),
      });
    });
    await installAdminBootstrapFixture(page, {
      context,
      scopes,
      selectedScope: { kind: "GLOBAL" },
      timezone: "Asia/Manila",
    });
    await page.goto("/admin/catalog/products/price-product");
    await expect(page.getByRole("heading", { name: "Exact-location prices" })).toBeVisible();
    await expect(page.getByText("Current price: Unavailable", { exact: true })).toBeVisible();
    await page.getByLabel("Final retail price").fill("25.50");
    await page.getByRole("button", { name: "Save price", exact: true }).click();
    await expect(page.getByText("Exact-location price saved.", { exact: true })).toBeVisible();
    expect(command).toMatchObject({
      skuId: "sku-1",
      locationId: "location-1",
      marketId: "market-1",
      amountMinor: 2550,
      expectedVersion: 0,
    });
    await page.getByText("Price history", { exact: true }).click();
    await expect(page.getByRole("list", { name: "Price history" })).toContainText("25.50");
    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Exact-location prices" }) });
    await section.screenshot({ path: testInfo.outputPath("global-prices.png") });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    local = true;
    await installAdminBootstrapFixture(page, {
      context: {
        ...context,
        capabilities: ["catalog.read", "catalog.manage", "inventory.read"],
        scopes: [{ kind: "location", locationId: "location-1" }],
      },
      scopes,
      selectedScope: { kind: "LOCATION", marketId: "market-1", locationId: "location-1" },
      timezone: "Asia/Manila",
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Review start selling", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Final retail price")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review price", exact: true })).toHaveCount(0);
  });
}
