import { expect, test } from "./admin-authenticated-fixture";

for (const failure of ["transport", "unconfirmed receipt"] as const)
  test(`desktop Product list deactivation retries the exact saved request after ${failure}`, async ({
    adminPage: page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = crypto.randomUUID();
    const name = `List recovery ${id.slice(0, 8)}`;
    await page.goto("/admin/catalog/products/new");
    await page.getByLabel("Product name", { exact: true }).fill(name);
    await page.getByLabel("Product slug").fill(`list-recovery-${id}`);
    await page.getByLabel("Product category").selectOption({ index: 1 });
    await page.getByLabel("Inventory base unit").selectOption("unit-gram");
    await page.getByLabel("SKU", { exact: true }).fill(`LIST_${id.slice(0, 8)}`);
    await page.getByLabel("Variant name").fill("250 g");
    await page.getByLabel("Sell unit").selectOption("unit-gram");
    await page.getByLabel("Quantity", { exact: true }).fill("250");
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    const productId = new URL(page.url()).pathname.split("/").at(-1);
    expect(productId).toBeTruthy();

    await page.goto(`/admin/catalog/products?query=${encodeURIComponent(name)}`);
    await page.getByRole("checkbox", { name: `Select ${name}` }).check();
    await page.getByRole("button", { name: "Deactivate", exact: true }).click();
    await page.getByLabel("Confirmation reason").fill("Season ended; preserve catalog history");
    const writes: Array<{ key: string | undefined; body: string | null }> = [];
    await page.route(`**/api/admin/catalog/products/${productId}/status`, async (route) => {
      writes.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      if (writes.length === 1 && failure === "transport") await route.abort("failed");
      else if (writes.length === 1)
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: {
              code: "CONFLICT",
              message: "Catalog result could not be confirmed; retry the saved request",
              requestId: "unconfirmed-browser-receipt",
            },
          }),
        });
      else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Confirm deactivation" }).click();
    await expect(page.getByRole("button", { name: "Retry saved deactivation" })).toBeVisible();
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/catalog\/products\?query=/);
    await page.getByRole("button", { name: "Retry saved deactivation" }).click();
    await expect(page.getByRole("button", { name: "Retry saved deactivation" })).toHaveCount(0);
    await expect(page.getByText("Bulk deactivation finished with exceptions")).toHaveCount(0);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    const result = await page.request.get(
      `/api/admin/catalog/products/${productId}?scopeKind=GLOBAL`,
    );
    expect(result.ok()).toBe(true);
    expect((await result.json()).value.status).toBe("inactive");
  });
