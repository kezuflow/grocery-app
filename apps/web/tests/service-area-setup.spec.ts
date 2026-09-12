import { test, expect } from "./admin-authenticated-fixture";
for (const width of [1440, 390]) {
  test(`global service-area editor is operational at ${width}px`, async ({ adminPage: page }) => {
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
      await page.getByRole("button", { name: "Publish service area" }).click();
      await expect(page.getByRole("status")).toContainText("Service area published");
      await expect(page.getByRole("heading", { name: areaName, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: `Edit ${areaName}` })).toBeVisible();
    }

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
}
