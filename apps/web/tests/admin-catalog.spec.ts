import { expect, test } from "./admin-authenticated-fixture";
import { resolve } from "node:path";

/**
 * Catalog and Inventory workspace flows against a provisioned local stack.
 * Skips when the app is unreachable. Authenticated journeys use the
 * deterministic local Staff fixture configured by Playwright.
 */
let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get("/");
    stackUp = response.status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async () => {
  test.skip(!stackUp, "Local stack is not running; start web+core to execute E2E flows.");
});

test("an unauthenticated visitor cannot open the catalog workspace", async ({ page }) => {
  await page.goto("/admin/catalog");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("an unauthenticated visitor cannot open the inventory workspace", async ({ page }) => {
  await page.goto("/admin/inventory");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("a provisioned Staff reader opens the real Catalog workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/catalog");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
});

test("a provisioned Staff reader can scan the Category workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/catalog/categories");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();
  await expect(
    adminPage.locator("#main-content").getByRole("link", { name: "Add category" }).first(),
  ).toBeVisible();
  await expect(adminPage.getByRole("table", { name: "Categories" })).toBeVisible();
  await expect(adminPage.getByRole("navigation", { name: "Results pagination" })).toBeVisible();
});

test("a provisioned Staff reader can scan the Product workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/catalog/products");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect(
    adminPage.locator("#main-content").getByRole("link", { name: "Add product" }).first(),
  ).toBeVisible();
  await expect(adminPage.getByRole("table", { name: "Products" })).toBeVisible();
  await expect(adminPage.getByRole("navigation", { name: "Results pagination" })).toBeVisible();
});

test("a catalog read-only principal sees no Product or Category mutation controls", async ({
  catalogReadOnlyPage,
}) => {
  await catalogReadOnlyPage.goto("/admin/catalog/products");
  await expect(
    catalogReadOnlyPage.getByRole("heading", { level: 1, name: "Products" }),
  ).toBeVisible();
  await expect(catalogReadOnlyPage.getByRole("link", { name: "Add product" })).toHaveCount(0);
  await catalogReadOnlyPage.getByRole("link", { name: "View" }).first().click();
  await expect(catalogReadOnlyPage.getByRole("button", { name: "Add variant" })).toHaveCount(0);

  await catalogReadOnlyPage.goto("/admin/catalog/categories");
  await expect(catalogReadOnlyPage.getByRole("link", { name: "Add category" })).toHaveCount(0);
});

test("a Product manager can create, inspect, and edit customer-facing details", async ({
  adminPage,
}) => {
  const suffix = crypto.randomUUID();
  await adminPage.goto("/admin/catalog/products/new");
  await adminPage.getByLabel("Product name").fill("E2E authored product");
  await adminPage.getByLabel("Product slug").fill(`e2e-authored-${suffix}`);
  await adminPage.getByLabel("Product description").fill("A customer-facing description.");
  await adminPage.getByLabel("Product category").selectOption({ index: 1 });
  await adminPage.getByLabel("Inventory base unit").selectOption("unit-gram");
  await adminPage.getByLabel("Detail label 1").fill("Storage");
  await adminPage.getByLabel("Detail value 1").fill("Keep refrigerated.");
  await adminPage.getByRole("button", { name: "Create product" }).click();
  await expect(adminPage.getByText("Product created.", { exact: true })).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "E2E authored product" }),
  ).toBeVisible();
  await expect(adminPage.getByText("Keep refrigerated.")).toBeVisible();
  await adminPage.getByLabel("Variant code").fill(`E2E_${suffix.slice(0, 8)}`);
  await adminPage.getByLabel("Variant name").fill("250 g");
  await adminPage.getByLabel("Sellable unit").selectOption("unit-gram");
  await adminPage.getByLabel("Sell quantity").fill("250");
  await adminPage.getByRole("button", { name: "Add variant" }).click();
  await expect(adminPage.getByText("Applied.", { exact: true })).toBeVisible();
  await adminPage.getByLabel(/New price for E2E_/).fill("29.99");
  await adminPage.getByRole("button", { name: "Review price" }).click();
  await expect(adminPage.getByRole("alertdialog")).toContainText("Global catalog");
  await expect(adminPage.getByRole("alertdialog")).toContainText("2999 minor units");
  await adminPage.getByRole("button", { name: "Keep unchanged" }).click();
  const scopeControl = adminPage.getByRole("combobox", { name: "Active admin scope" });
  if ((await scopeControl.evaluate((control) => control.tagName)) === "SELECT") {
    await scopeControl.selectOption({ label: "Central Cebu" });
  } else {
    await scopeControl.click();
    await adminPage
      .getByRole("option", { name: "Central Cebu" })
      .evaluate((option) => (option as HTMLElement).click());
  }
  await adminPage.getByRole("button", { name: "Review start selling" }).click();
  await expect(adminPage.getByRole("alertdialog")).toContainText("STOCKED sourcing");
  await adminPage.getByRole("button", { name: "Keep unchanged" }).click();
  if ((await scopeControl.evaluate((control) => control.tagName)) === "SELECT") {
    await scopeControl.selectOption({ label: "Global" });
  } else {
    await scopeControl.click();
    await adminPage
      .getByRole("option", { name: "Global" })
      .evaluate((option) => (option as HTMLElement).click());
  }
  await adminPage.getByRole("link", { name: "Edit product" }).click();
  await adminPage.getByLabel("Product name").fill("E2E updated product");
  await adminPage.getByRole("button", { name: "Save product" }).click();
  await expect(adminPage.getByText("Product updated.", { exact: true })).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "E2E updated product" }),
  ).toBeVisible();
  await adminPage
    .getByLabel("Product media image")
    .setInputFiles(resolve("public/produce/abiu.webp"));
  await adminPage.getByLabel("Media alt text").fill("E2E product image");
  await adminPage.getByLabel("Primary image").check();
  await adminPage.getByLabel("Media sort order").fill("1");
  await adminPage.getByRole("button", { name: "Upload media" }).click();
  await expect(adminPage.getByText("Media uploaded.", { exact: true })).toBeVisible();
  await expect(adminPage.getByLabel("Alt text for E2E product image")).toHaveValue(
    "E2E product image",
  );
  await adminPage.getByLabel("Alt text for E2E product image").fill("E2E updated media");
  await adminPage.getByRole("button", { name: "Save E2E product image" }).click();
  await expect(adminPage.getByText("Media updated.", { exact: true })).toBeVisible();
  await adminPage.getByRole("button", { name: "Review remove E2E updated media" }).click();
  await expect(adminPage.getByRole("alertdialog")).toContainText(
    "deactivates the canonical attachment before deleting its stored image",
  );
  await adminPage.getByRole("button", { name: "Confirm media removal" }).click();
  await expect(adminPage.getByText("Media removed.", { exact: true })).toBeVisible();
  await adminPage.getByLabel("Reason").fill("Lifecycle impact review");
  const reviewDeactivation = adminPage.getByRole("button", { name: "Review deactivation" });
  await reviewDeactivation.click();
  const statusDialog = adminPage.getByRole("alertdialog");
  await expect(statusDialog).toContainText("committed order snapshots remain intact");
  await expect(statusDialog.getByLabel("Confirmation reason")).toBeFocused();
  await adminPage.keyboard.press("Shift+Tab");
  await expect(statusDialog.getByRole("button", { name: "Confirm deactivation" })).toBeFocused();
  await statusDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(reviewDeactivation).toBeFocused();
});

test("a category manager can create and inspect a Category", async ({ adminPage }) => {
  const suffix = crypto.randomUUID();
  await adminPage.goto("/admin/catalog/categories/new");
  await adminPage
    .getByLabel("Category code")
    .fill(`E2E_${suffix.replaceAll("-", "_").toUpperCase()}`);
  await adminPage.getByLabel("Category name").fill("E2E hierarchy category");
  await adminPage.getByLabel("Category slug").fill(`e2e-hierarchy-${suffix}`);
  await adminPage.getByRole("button", { name: "Create category" }).click();
  await expect(adminPage.getByText("Category created.", { exact: true })).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "E2E hierarchy category" }),
  ).toBeVisible();
  await expect(adminPage.getByText("Recent audit")).toBeVisible();
  await adminPage.getByLabel("Status change reason").fill("Confirm impact copy");
  await adminPage.getByRole("button", { name: "Review deactivation" }).click();
  await expect(adminPage.getByRole("alertdialog")).toContainText(
    "Products and historical records remain intact",
  );
  await adminPage.getByRole("button", { name: "Cancel" }).click();
});

test("a Staff principal without capability is denied the Catalog workspace", async ({
  deniedAdminPage,
}) => {
  await deniedAdminPage.goto("/admin/catalog");
  await expect(deniedAdminPage.getByRole("alert")).toContainText(/requires.*catalog\.read/i);
});

test("category creation succeeds with capability and is denied without it", async ({
  adminPage,
  deniedAdminPage,
}) => {
  const suffix = crypto.randomUUID();
  const codeSuffix = suffix.replaceAll("-", "_").toUpperCase();
  const data = { code: `E2E_${codeSuffix}`, name: "E2E Category", slug: `e2e-${suffix}` };
  const allowed = await adminPage.request.post("/api/admin/catalog/categories", {
    data,
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  const allowedBody = await allowed.json();
  expect(allowedBody, JSON.stringify(allowedBody)).toMatchObject({
    ok: true,
    value: { code: data.code },
  });
  const denied = await deniedAdminPage.request.post("/api/admin/catalog/categories", {
    data: { ...data, code: `DENIED_${codeSuffix}`, slug: `denied-${suffix}` },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});
