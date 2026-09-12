import { test, expect } from "./admin-authenticated-fixture";
for (const width of [1440, 390]) {
  test(`retired service-area route returns to fulfillment locations at ${width}px`, async ({
    adminPage: page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/locations/service-areas");
    await expect(page).toHaveURL(/\/admin\/locations$/);
    await expect(page.getByRole("heading", { name: "Locations", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Service areas and routing preview" })).toHaveCount(
      0,
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
}
