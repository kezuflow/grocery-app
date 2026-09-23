import { expect, test } from "./admin-authenticated-fixture";

test("real Core navigation exposes Procurement, Receiving, Transfers and Catalog in the right scopes", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin");
  await adminPage.getByRole("button", { name: "Expand admin navigation" }).click();

  const navigation = adminPage.getByRole("navigation", { name: "Admin navigation" });
  await expect(navigation.locator('a[href="/admin/procurement"]')).toBeVisible();
  await expect(navigation.locator('a[href="/admin/transfers"]')).toBeVisible();
  await expect(navigation.locator('a[href="/admin/receiving"]')).toHaveCount(0);
  await navigation.getByRole("button", { name: "Products" }).click();
  await expect(navigation.getByRole("link", { name: "Catalog overview" })).toBeVisible();
  await expect(adminPage.locator('a[href="/admin/issues/operational-exceptions"]')).toHaveCount(1);

  await adminPage.getByRole("combobox", { name: "Active admin scope" }).click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(navigation.locator('a[href="/admin/procurement"]')).toBeVisible();
  await expect(navigation.locator('a[href="/admin/receiving"]')).toBeVisible();
  await expect(navigation.locator('a[href="/admin/transfers"]')).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Catalog overview" })).toHaveCount(0);

  await navigation.locator('a[href="/admin/receiving"]').click();
  await expect(adminPage.getByRole("heading", { level: 1, name: "Receiving" })).toBeVisible();
  await navigation.locator('a[href="/admin/procurement"]').click();
  await expect(adminPage.getByRole("heading", { level: 1, name: "Delivery week" })).toBeVisible();
});
