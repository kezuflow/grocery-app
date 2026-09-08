import type { Page } from "@playwright/test";
import { test, expect } from "./admin-authenticated-fixture";

async function loseNextResponse(page: Page, method: string, pathname: string) {
  await page.evaluate(
    ({ method, pathname }) => {
      const nativeFetch = window.fetch.bind(window);
      let lost = false;
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await nativeFetch(...args);
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
          throw new TypeError("Simulated lost Product response");
        }
        return response;
      };
    },
    { method, pathname },
  );
}

for (const width of [1440, 390]) {
  test(`Product create edit and status recovery at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const id = crypto.randomUUID();
    const requests: Array<{ method: string; url: string; body: string | null; key: string }> = [];
    page.on("request", (request) => {
      if (
        ["POST", "PATCH"].includes(request.method()) &&
        /\/api\/admin\/catalog\/products(?:\/[^/]+(?:\/status)?)?$/.test(
          new URL(request.url()).pathname,
        )
      )
        requests.push({
          method: request.method(),
          url: request.url(),
          body: request.postData(),
          key: request.headers()["idempotency-key"],
        });
    });
    await page.goto("/admin/catalog/products/new");
    await page.getByLabel("Product name", { exact: true }).fill(`Recovery product ${width}`);
    await page.getByLabel("Product slug").fill(`recovery-product-${id}`);
    await page.getByLabel("Product category").selectOption({ index: 1 });
    await page.getByLabel("Inventory base unit").selectOption("unit-gram");
    await page.getByLabel("SKU", { exact: true }).fill(`RECOVERY_${id.slice(0, 8)}`);
    await page.getByLabel("Variant name").fill("250 g");
    await page.getByLabel("Sell unit").selectOption("unit-gram");
    await page.getByLabel("Quantity", { exact: true }).fill("250");
    await loseNextResponse(page, "POST", "/api/admin/catalog/products");
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved setup" })).toBeVisible();
    await expect(page.getByLabel("Product name", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Retry saved setup" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Recovery product ${width}` }),
    ).toBeVisible();
    await expect(
      page.getByText(`RECOVERY_${id.slice(0, 8).toUpperCase()}`, { exact: true }).first(),
    ).toBeVisible();
    const productPath = new URL(page.url()).pathname.replace("/admin/", "/api/admin/");
    await page.getByRole("link", { name: "Edit product", exact: true }).click();
    await page.getByLabel("Product name", { exact: true }).fill(`Reviewed product ${width}`);
    await loseNextResponse(page, "PATCH", productPath);
    await page.getByRole("button", { name: "Save product", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved product" })).toBeVisible();
    await expect(page.getByLabel("Product name", { exact: true })).toBeDisabled();
    // A scope refresh must not replace or hide the uncertain edit request.
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved product" })).toBeVisible();
    await page.getByRole("button", { name: "Retry saved product" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Reviewed product ${width}` }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Global", exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Season ended; preserve catalog history");
    await loseNextResponse(page, "POST", `${productPath}/status`);
    await page.getByRole("button", { name: "Review deactivation", exact: true }).click();
    await page.getByRole("button", { name: "Confirm deactivation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved command" })).toBeVisible();
    await expect(page.getByLabel("Reason", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Retry saved command" }).click();
    await expect(
      page.getByRole("button", { name: "Review activation", exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(6);
    for (let index = 0; index < 6; index += 2) expect(requests[index + 1]).toEqual(requests[index]);
    expect(new Set(requests.map((request) => request.key)).size).toBe(3);
    await page.screenshot({
      path: testInfo.outputPath("product-command-recovery.png"),
      fullPage: true,
    });
  });
}
