import type { APIRequestContext, Page } from "@playwright/test";
import {
  z,
  adminCategorySummarySchema,
  adminProductSummarySchema,
  adminCatalogSkuSummarySchema,
  adminProductDetailSchema,
} from "@freshmarkets/validation";
import { catalogResultSchema } from "../../components/admin/catalog-command-state";
import { expect, test } from "./admin-authenticated-fixture";

async function create<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  schema: z.ZodType<T>,
) {
  const response = await request.post(`/api/admin/catalog/${path}`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data,
  });
  const result = catalogResultSchema(schema).parse(await response.json());
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
async function fixture(page: Page) {
  const id = crypto.randomUUID();
  const category = await create(
    page.request,
    "categories",
    {
      code: `V_${id.replaceAll("-", "").toUpperCase()}`,
      name: "Variant acceptance",
      slug: `variants-${id}`,
    },
    adminCategorySummarySchema,
  );
  const product = await create(
    page.request,
    "products",
    {
      categoryId: category.categoryId,
      name: "Variant control acceptance",
      slug: `variant-controls-${id}`,
      description: null,
      customerDetails: [],
      inventoryBaseUnitId: "unit-gram",
    },
    adminProductSummarySchema,
  );
  const skus = [];
  for (const [index, grams] of [1000, 250, 500].entries())
    skus.push(
      await create(
        page.request,
        "skus",
        {
          productId: product.productId,
          code: `${["A", "B", "C"][index]}_${id.slice(0, 8)}`,
          name: `${grams} g`,
          sellableUnitId: "unit-gram",
          sellQuantity: grams,
          consumptionBaseQuantity: grams,
        },
        adminCatalogSkuSummarySchema,
      ),
    );
  return { product, skus, path: `/admin/catalog/products/${product.productId}` };
}
async function loseResponse(page: Page, pathname: string, method: string) {
  await page.evaluate(
    ({ pathname, method }) => {
      const native = window.fetch.bind(window);
      let lost = false;
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await native(...args);
        const input = args[0];
        const url =
          typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
        if (
          !lost &&
          args[1]?.method === method &&
          new URL(url, location.origin).pathname === pathname &&
          response.ok
        ) {
          lost = true;
          throw new TypeError("TEST_LOST_VARIANT_RESPONSE");
        }
        return response;
      };
    },
    { pathname, method },
  );
}
async function detail(page: Page, productId: string) {
  const response = await page.request.get(
    `/api/admin/catalog/products/${productId}?scopeKind=GLOBAL`,
  );
  const result = catalogResultSchema(adminProductDetailSchema).parse(await response.json());
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

for (const width of [1440, 390])
  test(`Variant switches and complete saved order at ${width}px`, async ({ adminPage: page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    const { product, skus, path } = await fixture(page);
    const requests: Array<{ path: string; method: string; body: string | null; key: string }> = [];
    page.on("request", (request) => {
      if (
        ["POST", "PATCH", "PUT"].includes(request.method()) &&
        /\/api\/admin\/catalog\/(skus\/|products\/[^/]+\/variants\/order)/.test(
          new URL(request.url()).pathname,
        )
      )
        requests.push({
          path: new URL(request.url()).pathname,
          method: request.method(),
          body: request.postData(),
          key: request.headers()["idempotency-key"],
        });
    });
    await page.goto(path);
    const table = page.getByRole("table", { name: "Sell variants", exact: true });
    await expect(table.locator("tbody tr").first()).toContainText(skus[0].code);
    const handle = page.getByRole("button", { name: `Move ${skus[0].code}`, exact: true });
    await handle.scrollIntoViewIfNeeded();
    // Escape leaves the original complete order untouched.
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
      `${skus[0].code} at position 1.`,
    );
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
      `${skus[0].code} at position 2.`,
    );
    await page.keyboard.press("Escape");
    await expect(handle).not.toHaveAttribute("aria-pressed", "true");
    expect(requests).toHaveLength(0);
    await loseResponse(
      page,
      `/api/admin/catalog/products/${product.productId}/variants/order`,
      "POST",
    );
    if (width === 1440) {
      const source = await handle.boundingBox();
      const target = await table.locator("tbody tr").last().boundingBox();
      if (!source || !target) throw new Error("Missing sortable row bounds");
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2, target.y + target.height / 2, {
        steps: 12,
      });
      await page.mouse.up();
    } else {
      await handle.focus();
      await page.keyboard.press("Space");
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
        `${skus[0].code} at position 1.`,
      );
      await page.keyboard.press("ArrowDown");
      await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
        `${skus[0].code} at position 2.`,
      );
      await page.keyboard.press("ArrowDown");
      await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
        `${skus[0].code} at position 3.`,
      );
      await page.keyboard.press("Space");
    }
    await expect(page.getByRole("button", { name: "Retry saved variant change" })).toBeVisible();
    await expect(
      page.getByRole("switch", { name: `Selling ${skus[0].code}`, exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add variant", exact: true })).toBeDisabled();
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Active admin scope" })).toContainText(
      "Global",
    );
    await page.getByRole("button", { name: "Retry saved variant change" }).click();
    await expect(table.locator("tbody tr").last()).toContainText(skus[0].code);
    expect(requests[1]).toEqual(requests[0]);
    const saved = await detail(page, product.productId);
    expect(saved.skus.map((sku) => sku.skuId)).toEqual([
      skus[1].skuId,
      skus[2].skuId,
      skus[0].skuId,
    ]);
    expect(saved.skus.map((sku) => sku.sortOrder)).toEqual([0, 1, 2]);
    expect(saved.skus.map((sku) => sku.version)).toEqual([2, 2, 2]);
    await page.reload();
    await expect(table.locator("tbody tr").last()).toContainText(skus[0].code);
    await page.screenshot({ path: `../../.wrangler/variant-order-${width}.png`, fullPage: true });
    await loseResponse(page, `/api/admin/catalog/skus/${skus[0].skuId}`, "PATCH");
    await page.getByRole("switch", { name: `Selling ${skus[0].code}`, exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved variant change" })).toBeVisible();
    // The previous confirmed switch value remains visible until its receipt arrives.
    await expect(
      page.getByRole("switch", { name: `Selling ${skus[0].code}`, exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Retry saved variant change" }).click();
    await expect(
      page.getByRole("switch", { name: `Selling ${skus[0].code}`, exact: true }),
    ).not.toBeChecked();
    expect(requests[3]).toEqual(requests[2]);
    expect(
      (await detail(page, product.productId)).skus.find((sku) => sku.skuId === skus[0].skuId),
    ).toMatchObject({ status: "inactive", version: 3, sortOrder: 2 });
    await page.getByRole("button", { name: "Edit variant 1000 g", exact: true }).click();
    await expect(page.getByLabel("Variant display order")).toHaveCount(0);
    await expect(page.getByLabel("Variant catalog status")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    const localSwitch = page.getByRole("switch", { name: `Selling ${skus[1].code}`, exact: true });
    await expect(localSwitch).not.toBeChecked();
    await localSwitch.click();
    await expect(localSwitch).toBeChecked();
    expect(JSON.parse(requests[4].body ?? "{}")).toEqual({
      locationId: "location-cebu-central",
      availabilityStatus: "AVAILABLE",
      expectedVersion: 0,
    });
    await localSwitch.click();
    await expect(localSwitch).not.toBeChecked();
    expect(JSON.parse(requests[5].body ?? "{}")).toEqual({
      locationId: "location-cebu-central",
      availabilityStatus: "UNAVAILABLE",
      expectedVersion: 1,
    });
    expect(
      (await detail(page, product.productId)).skus.find((sku) => sku.skuId === skus[1].skuId)
        ?.status,
    ).toBe("active");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `../../.wrangler/variant-controls-${width}.png`,
      fullPage: true,
    });
  });

test("Global catalog readers see saved switches and positions without write controls", async ({
  catalogReadOnlyPage: page,
}) => {
  await page.goto("/admin/catalog/products/product-sitao-string-beans");
  const switches = page
    .getByRole("table", { name: "Sell variants", exact: true })
    .getByRole("switch");
  await expect(switches.first()).toBeVisible();
  expect(await switches.count()).toBeGreaterThan(0);
  for (const control of await switches.all()) await expect(control).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit variant / })).toHaveCount(0);
});

test.describe("Touch variant ordering", () => {
  test.use({ hasTouch: true });
  test("stale touch moves show the rejection; refreshed touch moves persist", async ({
    adminPage: page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 1000 });
    const { product, skus, path } = await fixture(page);
    await page.goto(path);
    const table = page.getByRole("table", { name: "Sell variants", exact: true });
    await expect(table.locator("tbody tr").first()).toContainText(skus[0].code);
    // A second authorized caller changes the reviewed SKU after this page read.
    const changed = await page.request.patch(`/api/admin/catalog/skus/${skus[0].skuId}`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { name: "1 kg", expectedVersion: 1 },
    });
    expect(await changed.json()).toMatchObject({ ok: true });
    const session = await page.context().newCDPSession(page);
    async function drag() {
      const handle = page.getByRole("button", { name: `Move ${skus[0].code}`, exact: true });
      await handle.scrollIntoViewIfNeeded();
      const source = await handle.boundingBox();
      const target = await table.locator("tbody tr").last().boundingBox();
      if (!source || !target) throw new Error("Missing touch row bounds");
      const x = source.x + source.width / 2;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: source.y + source.height / 2, id: 0 }],
      });
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: target.y + target.height / 2, id: 0 }],
      });
      await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
        `${skus[0].code} at position 3.`,
      );
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await drag();
    await expect(page.getByRole("alert")).toContainText("Product or variants changed");
    await expect(table.locator("tbody tr").first()).toContainText(skus[0].code);
    expect((await detail(page, product.productId)).skus.map((sku) => sku.sortOrder)).toEqual([
      0, 0, 0,
    ]);
    await page.getByRole("button", { name: "Refresh variants" }).click();
    await expect(
      page.getByRole("button", { name: "Edit variant 1 kg", exact: true }),
    ).toBeVisible();
    await drag();
    await expect(table.locator("tbody tr").last()).toContainText(skus[0].code);
    expect((await detail(page, product.productId)).skus.map((sku) => sku.skuId)).toEqual([
      skus[1].skuId,
      skus[2].skuId,
      skus[0].skuId,
    ]);
    await session.detach();
  });
});
