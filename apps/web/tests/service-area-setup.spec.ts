import { test, expect } from "./admin-authenticated-fixture";
for (const width of [1440, 390]) {
  test(`Global service-area publication and preview at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/locations");
    await page.getByRole("link", { name: "Service areas and routing preview" }).click();
    await expect(page.getByRole("heading", { name: "Service areas", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New service area", exact: true }).click();
    const name = `Boundary ${width} ${crypto.randomUUID().slice(0, 8)}`;
    await page.getByLabel("Area code", { exact: true }).fill(`browser-${crypto.randomUUID()}`);
    await page.getByLabel("Area name", { exact: true }).fill(name);
    for (const label of ["Service area boundary", "Zone 1 boundary"]) {
      const boundary = page.getByRole("group", { name: label, exact: true });
      for (const [latitude, longitude] of [
        [10.2, 123.8],
        [10.2, 124],
        [10.5, 124],
        [10.5, 123.8],
      ]) {
        await page.getByLabel(`${label} latitude`, { exact: true }).fill(String(latitude));
        await page.getByLabel(`${label} longitude`, { exact: true }).fill(String(longitude));
        await boundary.getByRole("button", { name: "Add boundary point", exact: true }).click();
      }
    }
    await page.getByLabel("Zone 1 code", { exact: true }).fill("central");
    await page.getByLabel("Zone 1 name", { exact: true }).fill("Central delivery");
    await page
      .getByRole("group", { name: "Eligible locations", exact: true })
      .getByRole("checkbox")
      .first()
      .check();
    await page.getByLabel("Reason", { exact: true }).fill("Browser acceptance boundary");
    await page.getByRole("button", { name: "Publish service area", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Service area published");
    await page.reload();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.getByLabel("Preview latitude", { exact: true }).fill("20");
    await page.getByLabel("Preview longitude", { exact: true }).fill("123.9");
    await page.getByRole("button", { name: "Preview routing", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("No eligible location");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page
      .getByRole("heading", { name: "Service areas", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("service-areas.png"), fullPage: true });
    await page.getByRole("button", { name: `Review ${name}`, exact: true }).click();
    await expect(page.getByLabel("Area name", { exact: true })).toHaveValue(name);
    await expect(page.getByLabel("Area code", { exact: true })).toBeDisabled();
  });
}
