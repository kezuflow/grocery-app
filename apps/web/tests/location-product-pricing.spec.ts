import { expect, test } from "@playwright/test";
import type {
  AdminContextView,
  AdminProductDetail,
  AdminProductPage,
  AdminScopeOptionView,
  AdminSkuPricesView,
} from "@freshmarkets/contracts";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

// Browser rendering/interaction with controlled RPC responses; not live D1 acceptance.
const scope = {
  kind: "LOCATION" as const,
  marketId: "market-1",
  marketName: "Metro Cebu",
  locationId: "location-1",
  locationName: "Central Cebu",
  currency: "PHP",
};
const product: AdminProductDetail = {
  productId: "price-product",
  categoryId: "vegetables",
  slug: "onion",
  name: "Onion",
  description: null,
  categoryCode: "VEGETABLES",
  categoryName: "Vegetables",
  categories: [{ categoryId: "vegetables", code: "VEGETABLES", name: "Vegetables" }],
  status: "active",
  version: 1,
  customerDetails: [],
  media: [],
  recentAudit: [],
  allowedActions: [],
  scope,
  inventoryPool: {
    inventoryPoolId: "pool-1",
    baseUnitId: "unit-gram",
    baseUnitCode: "GRAM",
    baseUnitSymbol: "g",
    position: {
      locationId: "location-1",
      onHandBase: 10_000,
      reservedBase: 500,
      availableBase: 9_500,
      version: 1,
    },
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
      currency: "PHP",
      availability: "AVAILABLE",
      availabilityVersion: 1,
    },
  ],
};
const pageResult: AdminProductPage = {
  scope,
  readiness: {
    activeProducts: 1,
    inactiveProducts: 0,
    missingPrimaryMedia: 1,
    missingPrices: 1,
    unavailableSkus: 0,
  },
  nextCursor: null,
  items: [
    {
      productId: product.productId,
      slug: product.slug,
      name: product.name,
      categoryCode: product.categoryCode,
      status: product.status,
      skuCount: 1,
      version: product.version,
      activeSkuCount: 1,
      pricedSkuCount: 0,
      availableSkuCount: 1,
      primaryMedia: null,
      priceRange: null,
      inventoryPosition: product.inventoryPool.position,
    },
  ],
};
const context: AdminContextView = {
  staffId: "staff-1",
  displayName: "Central Cebu price manager",
  email: "price-manager@example.test",
  capabilities: ["catalog.read", "inventory.read", "prices.read", "prices.manage"],
  scopes: [{ kind: "location", locationId: "location-1" }],
  environment: "test",
  navigation: [],
};
const scopes: AdminScopeOptionView[] = [
  {
    kind: "location",
    locationId: "location-1",
    locationCode: "CEBU-CENTRAL",
    locationName: "Central Cebu",
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
  test(`Central Cebu inline Product price editor at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let saved = false;
    let command: Record<string, unknown> | null = null;
    await page.route("**/api/admin/catalog/**", async (route) => {
      const requestUrl = new URL(route.request().url());
      const path = requestUrl.pathname;
      let value: unknown;
      if (path === "/api/admin/catalog/products") {
        value = saved
          ? {
              ...pageResult,
              readiness: { ...pageResult.readiness, missingPrices: 0 },
              items: [
                {
                  ...pageResult.items[0],
                  pricedSkuCount: 1,
                  priceRange: { minimumMinor: 2_550, maximumMinor: 2_550, currency: "PHP" },
                },
              ],
            }
          : pageResult;
      } else if (path.endsWith("/products/price-product")) {
        value = saved
          ? {
              ...product,
              skus: [{ ...product.skus[0], priceMinor: 2_550, priceVersion: 1 }],
            }
          : product;
      } else if (path.endsWith("/prices")) {
        value = initialPrices;
      } else if (path.endsWith("/price")) {
        command = route.request().postDataJSON();
        saved = true;
        value = { ...product.skus[0], priceMinor: 2_550, priceVersion: 1 };
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
      selectedScope: { kind: "LOCATION", marketId: "market-1", locationId: "location-1" },
      timezone: "Asia/Manila",
    });

    await page.goto("/admin/catalog/products");
    await page.getByRole("button", { name: "Preview Onion" }).click();
    await expect(page.getByText("Central Cebu fulfillment preview", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit price for 500 g" }).click();
    await page.getByRole("textbox", { name: "Price for 500 g", exact: true }).fill("25.50");
    await page.getByRole("button", { name: "Save price", exact: true }).click();

    await expect(page.getByText("Location price saved.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit price for 500 g" })).toContainText("25.50");
    expect(command).toMatchObject({
      skuId: "sku-1",
      locationId: "location-1",
      marketId: "market-1",
      amountMinor: 2_550,
      expectedVersion: 0,
    });
    await page.locator("#product-detail-panel").screenshot({
      path: testInfo.outputPath("location-product-price-preview.png"),
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test(`Central Cebu view-only Product ownership at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const readOnlyContext = {
      ...context,
      capabilities: ["catalog.read", "inventory.read", "prices.read"],
    } satisfies AdminContextView;
    const pricedProduct = {
      ...product,
      skus: [{ ...product.skus[0], priceMinor: 2_550, priceVersion: 1 }],
    } satisfies AdminProductDetail;
    await page.route("**/api/admin/catalog/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const value =
        path === "/api/admin/catalog/products"
          ? pageResult
          : path.endsWith("/products/price-product")
            ? pricedProduct
            : null;
      await route.fulfill({
        status: value ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(
          value
            ? { ok: true, value, requestId: "browser" }
            : {
                ok: false,
                error: { code: "NOT_FOUND", message: "No test route", requestId: "browser" },
              },
        ),
      });
    });
    await installAdminBootstrapFixture(page, {
      context: readOnlyContext,
      scopes,
      selectedScope: { kind: "LOCATION", marketId: "market-1", locationId: "location-1" },
      timezone: "Asia/Manila",
    });

    await page.goto("/admin/catalog/products");
    await page.getByRole("button", { name: "Preview Onion" }).click();
    const preview = page.locator("#product-detail-panel");
    await expect(preview).toContainText("Central Cebu fulfillment preview");
    await expect(preview).toContainText("Prices for Central Cebu are view-only");
    await expect(preview).toContainText("₱25.50");
    await expect(preview).toContainText("Physical stock");
    await expect(preview).toContainText("10,000 g");
    await expect(preview).toContainText("Reserved stock");
    await expect(preview).toContainText("500 g");
    await expect(preview).toContainText("Available stock");
    await expect(preview).toContainText("9,500 g");
    await expect(preview).not.toContainText("Metro Cebu");
    await expect(preview.getByRole("button", { name: "Edit price for 500 g" })).toHaveCount(0);
    await expect(preview.getByRole("button", { name: "Save price" })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (process.env.SAUI_CAPTURE_PRODUCT_SCOPE === "1") {
      await preview.screenshot({
        path: `../../docs/operations/checkpoints/evidence/saui-04/products-location-readonly-${width}.png`,
      });
    }
  });
}
