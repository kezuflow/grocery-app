import { test, expect } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`Create variant and save local price after lost responses at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const suffix = crypto.randomUUID();
    await page.goto("/admin/catalog/products/new");
    await page.getByLabel("Product name", { exact: true }).fill(`Variant journey ${width}`);
    await page.getByLabel("Product slug").fill(`variant-journey-${suffix}`);
    await page.getByLabel("Product category").selectOption({ index: 1 });
    await page.getByLabel("Inventory base unit").selectOption("unit-gram");
    await page.getByLabel("SKU", { exact: true }).fill(`FIRST_${suffix.slice(0, 8)}`);
    await page.getByLabel("Variant name").fill("250 g");
    await page.getByLabel("Sell unit").selectOption("unit-gram");
    await page.getByLabel("Quantity", { exact: true }).fill("250");
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Variant journey ${width}` }),
    ).toBeVisible();

    const variants: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/catalog/skus", async (route) => {
      variants.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (variants.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByLabel("SKU code", { exact: true }).fill(`SECOND_${suffix.slice(0, 8)}`);
    await page.getByLabel("Display name", { exact: true }).fill("500 g");
    await page.getByLabel("Unit", { exact: true }).selectOption("unit-gram");
    await page.getByLabel("Amount", { exact: true }).fill("500");
    await page.getByRole("button", { name: "Add variant", exact: true }).click();
    await page.getByRole("button", { name: "Retry saved command", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: `SECOND_${suffix.slice(0, 8)}`.toUpperCase(), exact: true }),
    ).toHaveCount(1);
    expect(variants).toHaveLength(2);
    expect(variants[1]).toEqual(variants[0]);
    expect(JSON.parse(variants[0].body ?? "{}")).toMatchObject({
      sellQuantity: 500,
      consumptionBaseQuantity: 500,
    });

    const prices: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/catalog/skus/*/price", async (route) => {
      prices.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (prices.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("combobox", { name: "Price variant", exact: true }).click();
    await page.getByRole("option", { name: "500 g", exact: true }).click();
    await page.getByRole("combobox", { name: "Price location", exact: true }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await page.getByLabel("Final retail price", { exact: true }).fill("29.50");
    await page.getByRole("button", { name: "Save price", exact: true }).click();
    await page.getByRole("button", { name: "Retry same price request", exact: true }).click();
    await expect(page.getByText("Exact-location price saved.", { exact: true })).toBeVisible();
    expect(prices).toHaveLength(2);
    expect(prices[1]).toEqual(prices[0]);
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    const row = page.getByRole("row").filter({
      has: page.getByRole("cell", {
        name: `SECOND_${suffix.slice(0, 8)}`.toUpperCase(),
        exact: true,
      }),
    });
    await row.getByRole("button", { name: "Review start selling", exact: true }).click();
    await page.getByRole("button", { name: "Confirm selling status", exact: true }).click();
    await expect(row.getByRole("status")).toHaveText("Selling");
    await expect(page.getByRole("button", { name: "Save price", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("catalog-variant.png"), fullPage: true });
  });
}
