import { expect, test } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`Global Product preview exposes lifecycle and category controls at ${width}px`, async ({
    adminPage: page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/catalog/products?query=abiu");
    await page.getByRole("button", { name: "Preview Abiu" }).click();

    await expect(page.getByText("Global product preview", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Product name")).toHaveValue("Abiu");
    await expect(page.getByLabel("Product status")).toBeVisible();
    expect(await page.locator('[aria-label$=" status"]').count()).toBeGreaterThanOrEqual(2);

    await page.getByRole("button", { name: "Product categories" }).click();
    await expect(page.getByRole("checkbox").last()).toBeVisible();
    expect(await page.getByRole("checkbox").count()).toBeGreaterThan(1);
    await expect(page.getByText("Primary", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel("Product name").fill("Abiu preview");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByLabel("Product name")).toHaveValue("Abiu preview");

    await page.getByLabel("Product name").fill("Abiu");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByLabel("Product name")).toHaveValue("Abiu");
  });
}
