import { expect, test } from "./admin-authenticated-fixture";

test("dirty Product creation confirms scope changes and discards its draft", async ({
  adminPage,
}) => {
  await adminPage.goto("/admin/catalog/products/new");
  const selector = adminPage.getByRole("combobox", { name: "Active admin scope" });
  const name = adminPage.getByLabel("Product name", { exact: true });
  await expect(name).toBeVisible();
  await name.fill("Unsaved local draft");

  adminPage.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Discard unsaved changes");
    await dialog.dismiss();
  });
  await selector.click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(selector).toContainText("Global");
  await expect(name).toHaveValue("Unsaved local draft");

  adminPage.once("dialog", async (dialog) => dialog.accept());
  await selector.click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(selector).toContainText("Central Cebu");
  await expect(adminPage.getByRole("alert")).toContainText(
    "Select Global scope to create a product.",
  );
  await expect(name).toHaveCount(0);

  await selector.click();
  await adminPage.getByRole("option", { name: "Global", exact: true }).click();
  await expect(name).toHaveValue("");
});

test("dirty Category creation confirms scope changes and discards its draft", async ({
  adminPage,
}) => {
  await adminPage.goto("/admin/catalog/categories/new");
  const selector = adminPage.getByRole("combobox", { name: "Active admin scope" });
  const name = adminPage.getByLabel("Category name");
  await expect(name).toBeVisible();
  await name.fill("Unsaved category draft");

  adminPage.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Discard unsaved changes");
    await dialog.dismiss();
  });
  await selector.click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(selector).toContainText("Global");
  await expect(name).toHaveValue("Unsaved category draft");

  adminPage.once("dialog", async (dialog) => dialog.accept());
  await selector.click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(selector).toContainText("Central Cebu");
  await expect(adminPage.getByRole("alert")).toContainText(
    "Select Global scope to create a category.",
  );
  await expect(name).toHaveCount(0);

  await selector.click();
  await adminPage.getByRole("option", { name: "Global", exact: true }).click();
  await expect(name).toHaveValue("");
});

test("Product scope changes clear stale selection and cursor while keeping the named filter", async ({
  adminPage,
}) => {
  await adminPage.goto("/admin/catalog/products?query=abiu");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await adminPage
    .getByRole("button", { name: /^Preview / })
    .first()
    .click();
  await expect(adminPage.getByRole("button", { name: "Close product preview" })).toBeVisible();
  await adminPage.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("cursor", "old-scope-cursor");
    url.searchParams.append("cursorHistory", "");
    window.history.replaceState(null, "", url);
  });
  const selector = adminPage.getByRole("combobox", { name: "Active admin scope" });
  await selector.click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(selector).toContainText("Central Cebu");
  await expect(adminPage).toHaveURL(/\/admin\/catalog\/products\?query=abiu$/);
  await expect(adminPage.getByRole("button", { name: "Close product preview" })).toHaveCount(0);
  await selector.click();
  await adminPage.getByRole("option", { name: "Global", exact: true }).click();
  await expect(adminPage.getByRole("button", { name: "Close product preview" })).toHaveCount(0);
});
