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
    if (width === 1440) {
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/catalog\/categories\/new$/);
    }
    await expect(page.getByLabel("Category name")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
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
    if (width === 1440) {
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/catalog\/categories\/[^/]+\/edit(?:\?.*)?$/);
    }
    await expect(page.getByLabel("Category name")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
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

  test(`Category list deactivation retains its request after a lost response at ${width}px`, async ({
    adminPage: page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    const token = crypto.randomUUID().slice(0, 8);
    const name = `List recovery ${token}`;
    const created = await page.request.post("/api/admin/catalog/categories", {
      data: { code: `LIST_${token.toUpperCase()}`, name, slug: `list-recovery-${token}` },
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    const createdBody = await created.json();
    expect(createdBody.ok).toBe(true);
    const categoryId = createdBody.value.categoryId as string;
    await page.goto(`/admin/catalog/categories?query=${token}&status=active`);
    const requests: Array<{ method: string; url: string; body: string | null; key: string }> = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/categories\/[^/]+\/status$/.test(request.url()))
        requests.push({
          method: request.method(),
          url: request.url(),
          body: request.postData(),
          key: request.headers()["idempotency-key"],
        });
    });
    await page.getByRole("button", { name: `Open actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByLabel("Confirmation reason").fill("No longer in the active hierarchy");
    await loseNextResponse(page, "POST", `/api/admin/catalog/categories/${categoryId}/status`);
    await dialog.getByRole("button", { name: "Confirm deactivation" }).click();
    await expect(dialog.getByRole("button", { name: "Retry saved deactivation" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Retry saved deactivation" }).click();
    await expect(page.getByText(`${name} deactivated.`)).toBeVisible();
    await expect(page.getByText("No categories match these filters.")).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });
}

test("embedded Category creation keeps its panel open while the saved request is uncertain", async ({
  adminPage: page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const token = crypto.randomUUID().slice(0, 8);
  await page.goto("/admin/catalog/categories");
  await page.getByRole("button", { name: "Add category" }).click();
  const panel = page.locator("#category-detail-panel");
  await panel.getByLabel("Category code").fill(`EMBED_${token.toUpperCase()}`);
  await panel.getByLabel("Category name").fill(`Embedded recovery ${token}`);
  await panel.getByLabel("Category slug").fill(`embedded-${token}`);
  await loseNextResponse(page, "POST", "/api/admin/catalog/categories");
  await panel.getByRole("button", { name: "Create category" }).click();
  await expect(panel.getByRole("button", { name: "Retry saved category" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add category" })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Active admin scope" })).toContainText("Global");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Retry saved category" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add category" })).toBeEnabled();
});

test("embedded Category creation refreshes the filtered list after success", async ({
  adminPage: page,
}) => {
  const token = crypto.randomUUID().slice(0, 8);
  const name = `Embedded list ${token}`;
  await page.goto(`/admin/catalog/categories?query=${token}`);
  await expect(page.getByText("No categories match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Add category" }).click();
  const panel = page.locator("#category-detail-panel");
  await panel.getByLabel("Category code").fill(`EMBED_LIST_${token.toUpperCase()}`);
  await panel.getByLabel("Category name").fill(name);
  await panel.getByLabel("Category slug").fill(`embedded-list-${token}`);
  await panel.getByRole("button", { name: "Create category" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(page.getByText("1 category shown")).toBeVisible();
});
