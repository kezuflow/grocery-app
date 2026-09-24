import { test, expect } from "./admin-authenticated-fixture";

test("desktop service-area draft stays Global and guards scope changes", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/locations/service-areas");
  await page.getByRole("button", { name: "Add service area" }).click();
  const name = page.getByLabel("Area name");
  await name.fill("Unsaved boundary draft");
  const scope = page.getByRole("combobox", { name: "Active admin scope" });
  page.once("dialog", async (dialog) => dialog.dismiss());
  await scope.click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(scope).toContainText("Global");
  await expect(name).toHaveValue("Unsaved boundary draft");

  page.once("dialog", async (dialog) => dialog.accept());
  await scope.click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(scope).toContainText("Central Cebu");
  await expect(page).toHaveURL(/\/admin\/locations\/service-areas$/);
  await expect(name).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Service areas", exact: true })).toBeVisible();
});
for (const width of [1440, 390]) {
  test(`global service-area editor is operational at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/locations/service-areas");
    await expect(page).toHaveURL(/\/admin\/locations\/service-areas$/);
    await expect(page.getByRole("heading", { name: "Service areas", exact: true })).toBeVisible();
    await expect(
      page.locator("main").getByRole("link", { name: "Locations", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Add service area" })).toBeVisible();

    if (width === 1440) {
      const suffix = crypto.randomUUID().slice(0, 8);
      const areaName = `Cebu browser ${suffix}`;
      await page.getByRole("button", { name: "Add service area" }).click();
      await page.getByLabel("Area code").fill(`BROWSER_CEBU_${suffix}`);
      await page.getByLabel("Area name").fill(areaName);
      await page.getByText("Enter boundary coordinates manually", { exact: true }).click();
      for (const point of [
        { latitude: "10.30", longitude: "123.88" },
        { latitude: "10.34", longitude: "123.88" },
        { latitude: "10.34", longitude: "123.93" },
        { latitude: "10.30", longitude: "123.93" },
      ]) {
        await page.getByLabel("Service area latitude").fill(point.latitude);
        await page.getByLabel("Service area longitude").fill(point.longitude);
        await page.getByRole("button", { name: "Add boundary point" }).click();
      }
      await page.getByLabel("Reason").fill("Browser acceptance boundary");
      await page.screenshot({
        path: testInfo.outputPath("service-area-editor.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Publish service area" }).click();
      await expect(
        page.getByText("Service area published. New address checks now use this boundary."),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole("heading", { name: areaName, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: `Edit ${areaName}` })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("service-areas-list.png"),
        fullPage: true,
      });
    }

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
}
