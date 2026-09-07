import { test, expect } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`Global location creation and activation at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/locations");
    await expect(page.getByRole("heading", { name: "Locations", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    const name = `Warehouse ${width} ${crypto.randomUUID().slice(0, 8)}`;
    await page.getByLabel("Location name", { exact: true }).fill(name);
    await page
      .getByLabel("Location code", { exact: true })
      .fill(`warehouse-${crypto.randomUUID()}`);
    await page.getByRole("combobox", { name: "Market", exact: true }).click();
    await page.getByRole("option").first().click();
    await page.getByRole("combobox", { name: "Purpose", exact: true }).click();
    await page.getByRole("option", { name: "Central warehouse", exact: true }).click();
    for (const [field, value] of [
      ["Address line 1", "Test receiving road"],
      ["City", "Cebu"],
      ["Region", "Cebu"],
      ["Confirmed latitude", "10.32"],
      ["Confirmed longitude", "123.91"],
      ["Reason for this change", "Set up receiving warehouse"],
    ]) {
      await page.getByLabel(field, { exact: true }).fill(value);
    }
    await page.getByRole("checkbox", { name: "receiving", exact: true }).check();
    await page.getByRole("checkbox", { name: "storage", exact: true }).check();
    await page.getByRole("button", { name: "Create inactive location", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Location saved.");
    await page.getByRole("button", { name: `Review ${name}`, exact: true }).click();
    await page
      .getByLabel("Reason for this change", { exact: true })
      .fill("Receiving address and capabilities checked");
    await page.getByRole("button", { name: "Activate location", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Location saved.");
    await page.reload();
    const row = page.getByRole("heading", { name, exact: true }).locator("../..");
    await expect(row).toContainText("Central warehouse · active");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("locations.png"), fullPage: true });
    await page.getByRole("button", { name: `Review ${name}`, exact: true }).click();
    await page
      .getByLabel("Reason for this change", { exact: true })
      .fill("Close test receiving site");
    await page.getByRole("button", { name: "Deactivate location", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Location saved.");
    await expect(page.getByRole("heading", { name, exact: true }).locator("../..")).toContainText(
      "Central warehouse · inactive",
    );
  });
}
