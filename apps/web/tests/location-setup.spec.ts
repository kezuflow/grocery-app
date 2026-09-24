import { expect, test } from "./admin-authenticated-fixture";

test("desktop Locations index separates global service areas from pickup sites", async ({
  adminPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/locations");
  await expect(page.getByRole("heading", { name: "Locations", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage global service areas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review setup for Central Cebu" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("locations-index.png") });
});

test("desktop location draft keeps its URL target across scope changes", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/locations/location-cebu-central");
  const name = page.getByLabel("Location name", { exact: true });
  await expect(name).toBeVisible();
  const savedName = await name.inputValue();
  await name.fill("Unsaved location draft");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Discard unsaved changes");
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: /2 Pickup contact/ }).click();
  await expect(page).toHaveURL(/\/admin\/locations\/location-cebu-central$/);
  await expect(name).toHaveValue("Unsaved location draft");

  const scope = page.getByRole("combobox", { name: "Active admin scope" });
  page.once("dialog", async (dialog) => dialog.dismiss());
  await scope.click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(scope).toContainText("Global");
  await expect(name).toHaveValue("Unsaved location draft");

  page.once("dialog", async (dialog) => dialog.accept());
  await scope.click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(scope).toContainText("Central Cebu");
  await expect(page).toHaveURL(/\/admin\/locations\/location-cebu-central$/);
  await expect(name).toHaveValue(savedName);
});

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
  await page.getByRole("button", { name: "Deactivate location", exact: true }).click();
  const deactivation = page.getByRole("alertdialog", { name: "Deactivate location" });
  await expect(deactivation).toBeVisible();
  await expect(deactivation.getByLabel("Confirmation reason")).toBeVisible();
  await deactivation.getByRole("button", { name: "Keep unchanged" }).click();
  await expect(deactivation).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("location-setup-review.png"), fullPage: true });

  const attempts: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/admin/locations", async (route) => {
    if (
      route.request().method() !== "POST" ||
      route.request().postDataJSON()?.action !== "DEACTIVATE"
    )
      return route.continue();
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (attempts.length === 1) return route.abort("failed");
    await route.fulfill({
      json: {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "Location still has operational work.",
          requestId: "local-test",
        },
      },
    });
  });
  await page.getByRole("button", { name: "Deactivate location", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Deactivate location" });
  await confirmation.getByLabel("Confirmation reason").fill("Review deactivation recovery");
  await confirmation.getByRole("button", { name: "Deactivate location" }).click();
  await expect(confirmation.getByRole("alert")).toContainText("not confirmed");
  await expect(confirmation.getByLabel("Confirmation reason")).toBeDisabled();
  await confirmation.getByRole("button", { name: "Retry deactivation" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Location still has operational work");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
