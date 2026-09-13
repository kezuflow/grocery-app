import { expect, test } from "./admin-authenticated-fixture";

test("desktop location setup saves each step and explicitly enables dispatch", async ({
  adminPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/locations/location-cebu-central");
  await expect(page.getByText(/Step 1 of 4/)).toBeVisible();
  await page.locator("#location-addressLine1").fill("Test pickup entrance");
  await page.locator("#location-city").fill("Cebu");
  await page.locator("#location-region").fill("Cebu");
  await page.locator("#location-countryCode").fill("PH");
  await page.locator("#location-reason").fill("Review local test setup");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page).toHaveURL(/\/pickup$/);
  await expect(page.getByText(/Step 2 of 4/)).toBeVisible();
  await expect(page.getByText("Pickup location from step 1")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Address line 1", exact: true })).toHaveCount(0);
  await page.getByLabel("Sender name", { exact: true }).fill("Test pickup contact");
  await page.getByLabel("Sender phone (+63…)", { exact: true }).fill("+639171234567");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(page.getByText(/Step 3 of 4/)).toBeVisible();
  if ((await page.getByRole("button", { name: /Remove interval/ }).count()) === 0)
    await page.getByRole("button", { name: "Add operating interval", exact: true }).click();
  await page.getByLabel("Reason for schedule change", { exact: true }).fill("Review test hours");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page).toHaveURL(/\/fulfillment$/);
  await expect(page.getByText(/Step 4 of 4/)).toBeVisible();
  if (await page.getByRole("button", { name: "Activate location", exact: true }).count()) {
    await page.getByLabel("Reason for activation", { exact: true }).fill("Test setup reviewed");
    await page.getByRole("button", { name: "Activate location", exact: true }).click();
    await expect(page.getByRole("button", { name: "Activate location", exact: true })).toHaveCount(
      0,
    );
  }
  const readiness = page.getByRole("checkbox", {
    name: "Ready to dispatch customer orders",
    exact: true,
  });
  if ((await readiness.getAttribute("aria-checked")) !== "true") {
    await readiness.check();
    await page
      .getByLabel("Reason for change (required)", { exact: true })
      .fill("Test dispatch ready");
    await page.getByRole("button", { name: "Save fulfillment settings", exact: true }).click();
  }
  await expect(page.getByText("Saved dispatch status: Ready", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved dispatch status: Ready", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("location-setup-review.png"), fullPage: true });
});
