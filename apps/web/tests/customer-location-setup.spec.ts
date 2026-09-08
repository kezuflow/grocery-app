import { test, expect } from "./admin-authenticated-fixture";
test("Global creates a customer site through operating hours, pickup, service area and readiness", async ({
  adminPage: page,
}, testInfo) => {
  test.setTimeout(180000);
  const name = `Customer site ${crypto.randomUUID().slice(0, 8)}`;
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto("/admin/locations");
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await page.getByLabel("Location name", { exact: true }).fill(name);
  await page.getByLabel("Location code", { exact: true }).fill(`site-${crypto.randomUUID()}`);
  await page.getByRole("combobox", { name: "Market", exact: true }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("combobox", { name: "Purpose", exact: true }).click();
  await page.getByRole("option", { name: "Customer fulfillment site", exact: true }).click();
  for (const [field, value] of [
    ["Address line 1", "Test dispatch road"],
    ["City", "Cebu"],
    ["Region", "Cebu"],
    ["Confirmed latitude", "10.32"],
    ["Confirmed longitude", "123.91"],
    ["Reason for this change", "Set up customer dispatch site"],
  ]) {
    await page.getByLabel(field, { exact: true }).fill(value);
  }
  for (const capability of ["picking", "packing", "dispatch"])
    await page.getByRole("checkbox", { name: capability, exact: true }).check();
  await page.getByRole("button", { name: "Create inactive location", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Location saved.");
  await page.getByRole("button", { name: `Review ${name}`, exact: true }).click();
  await page
    .getByLabel("Reason for this change", { exact: true })
    .fill("Address and operational capabilities checked");
  await page.getByRole("button", { name: "Activate location", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Location saved.");
  await page.getByRole("link", { name: `Operating hours for ${name}`, exact: true }).click();
  for (const [index, day] of [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ].entries()) {
    await page.getByRole("button", { name: "Add operating interval", exact: true }).click();
    await page.getByRole("combobox", { name: `Day ${index + 1}`, exact: true }).click();
    await page.getByRole("option", { name: day, exact: true }).click();
    await page.getByLabel(`Interval ${index + 1} opens`, { exact: true }).fill("00:00");
    await page.getByLabel(`Interval ${index + 1} closes`, { exact: true }).fill("24:00");
  }
  await page
    .getByLabel("Reason for schedule change", { exact: true })
    .fill("Synthetic all-day browser test schedule");
  await page.getByRole("button", { name: "Save operating schedule", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Operating schedule saved");
  await page.goto("/admin/delivery");
  const scope = page.getByRole("combobox", { name: "Active admin scope" });
  if (await scope.evaluate((element) => element.tagName === "SELECT"))
    await scope.selectOption({ label: name });
  else {
    await scope.click();
    await page.getByRole("option", { name, exact: true }).click();
  }
  await page.getByText("Store courier pickup profile", { exact: true }).click();
  for (const [label, value] of [
    ["Sender name", "Test dispatch contact"],
    ["Sender phone (+63…)", "+639171110000"],
    ["Full pickup address", "Test dispatch road, Cebu"],
    ["Address line 1", "Test dispatch road"],
    ["City", "Cebu"],
  ]) {
    await page.getByRole("textbox", { name: label, exact: true }).fill(value);
  }
  await page.getByRole("button", { name: /^(Save|Update) pickup profile$/ }).click();
  await expect(
    page.getByRole("button", { name: "Update pickup profile", exact: true }),
  ).toBeVisible();
  await page.goto("/admin/locations");
  await page.getByRole("link", { name: "Service areas and routing preview" }).click();
  await page.getByRole("button", { name: "New service area", exact: true }).click();
  await page.getByLabel("Area code", { exact: true }).fill(`site-area-${crypto.randomUUID()}`);
  await page.getByLabel("Area name", { exact: true }).fill(`${name} service area`);
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
  await page.getByLabel("Zone 1 code", { exact: true }).fill("customer-zone");
  await page.getByLabel("Zone 1 name", { exact: true }).fill("Customer delivery zone");
  await page
    .getByRole("group", { name: "Eligible locations", exact: true })
    .getByRole("checkbox", { name, exact: true })
    .check();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic browser acceptance service boundary");
  await page.getByRole("button", { name: "Publish service area", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Service area published");
  await page.goto("/admin/locations");
  await page.getByRole("link", { name: `Fulfillment readiness for ${name}`, exact: true }).click();
  await page.getByRole("checkbox", { name: "Ready to dispatch customer orders" }).check();
  await page.getByLabel("Instant delivery promise (minutes)", { exact: true }).fill("60");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Setup reviewed through operational commands");
  await page.getByRole("button", { name: "Save fulfillment settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Fulfillment settings saved");
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Ready to dispatch customer orders" }),
  ).toBeChecked();
  await expect(page.getByLabel("Instant delivery promise (minutes)", { exact: true })).toHaveValue(
    "60",
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("customer-site-ready.png"), fullPage: true });
});
