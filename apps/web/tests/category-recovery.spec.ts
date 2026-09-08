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
          throw new TypeError("Simulated lost category response");
        }
        return response;
      };
    },
    { method, pathname },
  );
}
for (const width of [1440, 390]) {
  test(`Category create edit and status recovery at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const id = crypto.randomUUID();
    const requests: Array<{ method: string; url: string; body: string | null; key: string }> = [];
    page.on("request", (request) => {
      if (
        ["POST", "PATCH"].includes(request.method()) &&
        request.url().includes("/api/admin/catalog/categories")
      )
        requests.push({
          method: request.method(),
          url: request.url(),
          body: request.postData(),
          key: request.headers()["idempotency-key"],
        });
    });
    await page.goto("/admin/catalog/categories/new");
    await page.getByLabel("Category code").fill(`AUDIT_${id.replaceAll("-", "").toUpperCase()}`);
    await page.getByLabel("Category name").fill(`Recovery category ${width}`);
    await page.getByLabel("Category slug").fill(`recovery-category-${id}`);
    await loseNextResponse(page, "POST", "/api/admin/catalog/categories");
    await page.getByRole("button", { name: "Create category", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved category" })).toBeVisible();
    await expect(page.getByLabel("Category name")).toBeDisabled();
    await page.getByRole("button", { name: "Retry saved category" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Recovery category ${width}` }),
    ).toBeVisible();
    const categoryPath = new URL(page.url()).pathname.replace("/admin/", "/api/admin/");
    await page.getByRole("link", { name: "Edit category", exact: true }).click();
    await page.getByLabel("Category name").fill(`Reviewed category ${width}`);
    await loseNextResponse(page, "PATCH", categoryPath);
    await page.getByRole("button", { name: "Save category", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved category" })).toBeVisible();
    await expect(page.getByLabel("Category name")).toBeDisabled();
    await page.getByRole("button", { name: "Retry saved category" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Reviewed category ${width}` }),
    ).toBeVisible();
    await loseNextResponse(page, "POST", `${categoryPath}/status`);
    await page.getByLabel("Status change reason").fill("Season finished; preserve catalog history");
    await page.getByRole("button", { name: "Review deactivation", exact: true }).click();
    await page.getByRole("button", { name: "Confirm deactivation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved category" })).toBeVisible();
    await expect(page.getByLabel("Status change reason")).toBeDisabled();
    await page.getByRole("button", { name: "Retry saved category" }).click();
    await expect(page.getByText("Category deactivated.", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review activation", exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(6);
    for (let index = 0; index < 6; index += 2) expect(requests[index + 1]).toEqual(requests[index]);
    expect(new Set(requests.map((request) => request.key)).size).toBe(3);
    await page.screenshot({ path: testInfo.outputPath("category-recovery.png"), fullPage: true });
  });
}
