import { expect, test, executeAdminE2eSql } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`Products direct numbered pages and persistent rejected saves at ${width}px`, async ({
    adminPage: page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 950 });
    const token = `numbered-${crypto.randomUUID()}`;
    // Disposable local read fixtures: no production/provider activity.
    executeAdminE2eSql(`
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<305)
      INSERT INTO inventory_pool(id,base_unit_id,sourcing_mode,created_at,updated_at)
      SELECT '${token}-pool-'||n,'unit-gram','STOCKED',100000+n,100000+n FROM numbers;
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<305)
      INSERT INTO product(id,category_id,inventory_pool_id,slug,name,status,created_at,updated_at)
      SELECT '${token}-'||n,(SELECT id FROM category WHERE status='active' ORDER BY id LIMIT 1),
        '${token}-pool-'||n,'${token}-'||n,'${token} '||printf('%03d',n),
        CASE WHEN n%2=0 THEN 'inactive' ELSE 'active' END,100000+n,100000+n FROM numbers;
    `);
    const listUrl = `/admin/catalog/products?query=${token}`;
    await page.goto(listUrl);
    const scope = page.getByRole("combobox", { name: "Active admin scope" });
    if (!(await scope.textContent())?.includes("Global")) {
      await scope.click();
      await page.getByRole("option", { name: "Global", exact: true }).click();
    }
    const pagination = page.getByRole("navigation", { name: "Products pagination" });
    await expect(pagination).toContainText("Page 1 of 7");
    await pagination.getByRole("link", { name: "Page 7", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`query=${token}&page=7$`));
    await expect(page.getByRole("checkbox", { name: `Select ${token} 005` })).toBeVisible();
    await expect(pagination).toContainText("Page 7 of 7");
    await pagination.getByLabel("Go to page").fill("4");
    await pagination.getByRole("button", { name: "Go", exact: true }).click();
    await expect(pagination).toContainText("Page 4 of 7");
    await expect(page.getByRole("checkbox", { name: `Select ${token} 155` })).toBeVisible();
    await page.reload();
    await expect(pagination).toContainText("Page 4 of 7");
    await page.goBack();
    await expect(pagination).toContainText("Page 7 of 7");
    await page.goForward();
    await expect(pagination).toContainText("Page 4 of 7");
    await page.getByRole("tab", { name: "Active", exact: true }).click();
    await expect(pagination).toContainText("Page 1 of 4");
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    await page.goto(`${listUrl}&status=active&page=999`);
    await expect(pagination).toContainText("Page 4 of 4");
    await expect(page).toHaveURL(new RegExp(`query=${token}&status=active&page=4$`));
    await scope.click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await expect(pagination).toContainText("Page 1 of 4");
    await scope.click();
    await page.getByRole("option", { name: "Global", exact: true }).click();
    const invalid = await page.request.get("/api/admin/catalog/products?scopeKind=GLOBAL&page=0");
    expect(await invalid.json()).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const mixed = await page.request.get(
      "/api/admin/catalog/products?scopeKind=GLOBAL&page=2&cursor=wrong",
    );
    expect(await mixed.json()).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const productId = `${token}-305`;
    const path = `/api/admin/catalog/products/${productId}`;
    const original = await (await page.request.get(`${path}?scopeKind=GLOBAL`)).json();
    expect(original.ok).toBe(true);
    await page.goto(`/admin/catalog/products/${productId}/edit`);
    await page.getByLabel("Product name", { exact: true }).fill(`Edited ${token}`);
    // Actual duplicate-slug rejection travels through Web, Core and local D1.
    await page.getByLabel("Product slug").fill(`${token}-304`);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const error = page.locator("#edit-product-save-error");
    await expect(error).toContainText("Request reference:");
    await expect(error).toBeInViewport();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
    await expect
      .poll(async () => (await page.request.get(`${path}?scopeKind=GLOBAL`)).status())
      .toBe(200);
    await expect(error).toBeVisible();
    await expect(page.getByLabel("Product name", { exact: true })).toHaveValue(`Edited ${token}`);
    const unchanged = await (await page.request.get(`${path}?scopeKind=GLOBAL`)).json();
    expect(unchanged.value.version).toBe(original.value.version);
    expect(unchanged.value.name).toBe(original.value.name);
    await page.screenshot({ path: `../../.wrangler/products-error-${width}.png` });
    await page.getByLabel("Product slug").fill(`${token}-305`);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Edited ${token}` })).toBeVisible();
    const saved = await (await page.request.get(`${path}?scopeKind=GLOBAL`)).json();
    expect(saved.value.version).toBe(original.value.version + 1);
    expect(saved.value.name).toBe(`Edited ${token}`);
  });
}
