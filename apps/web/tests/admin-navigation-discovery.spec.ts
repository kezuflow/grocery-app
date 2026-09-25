import { expect, test } from "./admin-authenticated-fixture";

test("real Core navigation exposes Procurement, Receiving, Transfers and Catalog in the right scopes", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("button", { name: "Collapse admin navigation" })).toBeVisible({
    timeout: 60000,
  });

  const navigation = adminPage.getByRole("navigation", { name: "Admin navigation" });
  await expect(navigation.locator('a[href="/admin/procurement"]')).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Stock Transfer" })).toBeVisible();
  await expect(navigation.locator('a[href="/admin/receiving"]')).toHaveCount(0);
  await navigation.getByRole("button", { name: "Products" }).click();
  await expect(navigation.getByRole("link", { name: "Catalog overview" })).toBeVisible();
  await adminPage.getByRole("combobox", { name: "Active admin scope" }).click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(navigation.locator('a[href="/admin/procurement"]')).toBeVisible();
  await expect(navigation.locator('a[href="/admin/receiving"]')).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Stock Transfer" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Catalog overview" })).toHaveCount(0);

  await navigation.locator('a[href="/admin/receiving"]').click();
  await expect(adminPage.getByRole("heading", { level: 1, name: "Receiving" })).toBeVisible();
  await navigation.locator('a[href="/admin/procurement"]').click();
  await expect(adminPage.getByRole("heading", { level: 1, name: "Delivery weeks" })).toBeVisible();
  await navigation.getByRole("link", { name: "Stock Transfer" }).click();
  await expect(adminPage.getByRole("heading", { level: 1, name: "Stock Transfer" })).toBeVisible();
});

test("Fulfillment setup is one sidebar link with four authorized areas", async ({
  adminPage,
}, testInfo) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin");
  const navigation = adminPage.getByRole("navigation", { name: "Admin navigation" });
  const setupLink = navigation.getByRole("link", { name: "Fulfillment setup" });
  await expect(setupLink).toBeVisible();
  const setupBounds = await setupLink.boundingBox();
  expect(setupBounds).not.toBeNull();
  expect(setupBounds!.y + setupBounds!.height).toBeLessThan(700);
  for (const label of ["Locations", "Service Areas", "Fulfillment mode", "Scheduled cycles"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
  await navigation.getByRole("button", { name: "Staff" }).click();
  await expect(navigation.getByRole("link", { name: "Roles" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Audit log" })).toBeVisible();
  await navigation.screenshot({
    path: testInfo.outputPath("fulfillment-setup-navigation-1440.png"),
  });
  await setupLink.click();
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "Fulfillment setup" }),
  ).toBeVisible();
  for (const label of ["Locations", "Service Areas", "Fulfillment mode", "Scheduled cycles"]) {
    await expect(adminPage.getByRole("heading", { level: 2, name: label })).toBeVisible();
  }

  await adminPage.getByRole("button", { name: "Open admin search" }).click();
  const palette = adminPage.getByRole("dialog", { name: "Admin command palette" });
  await palette.getByPlaceholder("Search workspaces...").fill("Scheduled cycles");
  await expect(palette.getByText("Scheduled cycles", { exact: true })).toBeVisible();
  await palette.getByText("Scheduled cycles", { exact: true }).click();
  await expect(adminPage).toHaveURL(/\/admin\/settings\/scheduled-cycles$/);
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "Scheduled cycles" }),
  ).toBeVisible();

  await adminPage.goto("/admin/settings/delivery-cycles");
  await expect(adminPage).toHaveURL(/\/admin\/settings\/scheduled-cycles$/);
  await adminPage.goto("/admin/settings");
  await expect(adminPage).toHaveURL(/\/admin\/settings\/fulfillment-mode$/);
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "Fulfillment mode" }),
  ).toBeVisible();

  await adminPage.getByRole("combobox", { name: "Active admin scope" }).click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(navigation.getByRole("link", { name: "Fulfillment setup" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Fulfillment mode" })).toHaveCount(0);
  await navigation.getByRole("link", { name: "Fulfillment setup" }).click();
  await expect(adminPage.getByRole("heading", { level: 2, name: "Locations" })).toBeVisible();
  await expect(adminPage.getByRole("heading", { level: 2, name: "Service Areas" })).toBeVisible();
  await expect(adminPage.getByRole("heading", { level: 2, name: "Fulfillment mode" })).toHaveCount(
    0,
  );
});

test("a fulfillment-only reader reaches setup without broader administration access", async ({
  fulfillmentReadOnlyPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin");
  const navigation = page.getByRole("navigation", { name: "Admin navigation" });
  await expect(navigation.getByRole("link", { name: "Fulfillment setup" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Locations", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Staff" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Fulfillment mode" })).toHaveCount(0);
  await navigation.getByRole("link", { name: "Fulfillment setup" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Fulfillment mode" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Scheduled cycles" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Locations" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open admin search" }).click();
  const palette = page.getByRole("dialog", { name: "Admin command palette" });
  await palette.getByPlaceholder("Search workspaces...").fill("Scheduled cycles");
  await palette.getByRole("option", { name: "Scheduled cycles" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Scheduled cycles" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Calendar view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New cycle" })).toHaveCount(0);
  await expect(page.getByText("Select Global to administer Scheduled cycles.")).toHaveCount(0);
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin\/settings\/fulfillment-mode$/);
  await expect(page.getByRole("heading", { level: 1, name: "Fulfillment mode" })).toBeVisible();
  await expect(page.getByText("FreshMarkets commerce")).toBeVisible();
  await expect(
    page.getByText("Global commerce configuration is not permitted for this account."),
  ).toHaveCount(0);
});
