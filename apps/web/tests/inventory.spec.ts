import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";

// Catalog setup is a fixture; stock creation, recovery and removal use the live Web/Core path.
for (const width of [1440, 390])
  test(`Create and recover inspected stock at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    const id = `00-stock-${crypto.randomUUID()}`,
      name = `Inspected stock ${width} ${id.slice(-6)}`;
    executeAdminE2eSql(`
      INSERT INTO inventory_pool(id,base_unit_id,sourcing_mode,created_at,updated_at)
        SELECT '${id}',base_unit_id,sourcing_mode,created_at,updated_at FROM inventory_pool WHERE id='pool-red-onion';
      INSERT INTO product(id,category_id,inventory_pool_id,slug,name,status,created_at,updated_at)
        SELECT '${id}',category_id,'${id}','${id}','${name}',status,created_at,updated_at FROM product WHERE inventory_pool_id='pool-red-onion';
    `);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/inventory");
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page
      .getByRole("option", { name: /Central/ })
      .first()
      .click();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.locator("td").nth(2)).toContainText("0 g");
    await row.getByLabel(`Stock quantity for ${name}`).fill("500");
    // Let Core commit, then lose the browser response. Retry must return that same adjustment.
    let lost = false;
    await page.route(`**/api/admin/inventory/${id}/adjustments`, async (route) => {
      if (lost) return route.continue();
      lost = true;
      await route.fetch();
      await route.abort("failed");
    });
    await row.getByRole("button", { name: "Add stock", exact: true }).click();
    await expect(page.getByLabel("Confirmation reason")).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText("The stock result is unknown.", { exact: false })).toBeVisible();
    await expect(row.getByRole("button", { name: "Add stock", exact: true })).toBeDisabled();
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/\/admin\/inventory$/);
    await expect(page.getByRole("button", { name: "Retry saved adjustment" })).toBeVisible();
    await page.getByRole("button", { name: "Retry saved adjustment" }).click();
    await expect(row).toContainText("500 g");
    await expect(
      page
        .getByRole("table", { name: "Stock activity" })
        .locator("tbody tr")
        .filter({ hasText: "Manual stock addition" }),
    ).toHaveCount(1);
    await row.getByLabel(`Stock quantity for ${name}`).fill("100");
    await row.getByRole("button", { name: "Remove stock", exact: true }).click();
    await expect(page.getByLabel("Confirmation reason")).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(row).toContainText("400 g");
    await page.reload();
    await expect(row).toContainText("400 g");
    await row.getByRole("button", { name: "View activity" }).click();
    await expect(
      page
        .getByRole("table", { name: "Stock activity" })
        .locator("tbody tr")
        .filter({ hasText: "Manual stock addition" }),
    ).toHaveCount(1);
    await expect(
      page
        .getByRole("table", { name: "Stock activity" })
        .locator("tbody tr")
        .filter({ hasText: "Manual stock removal" }),
    ).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("inventory.png"), fullPage: true });
  });
