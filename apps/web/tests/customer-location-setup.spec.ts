import { test, expect } from "./admin-authenticated-fixture";
test.describe.configure({ timeout: 240000 });
test("Global creates a ready site and a customer confirms delivery there", async ({
  adminPage: page,
  page: customer,
}, testInfo) => {
  const name = `Customer site ${crypto.randomUUID().slice(0, 8)}`;
  const coordinate = {
    latitude: 10.445 + Math.random() / 1000,
    longitude: 123.975 + Math.random() / 1000,
  };
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
    ["Confirmed latitude", String(coordinate.latitude)],
    ["Confirmed longitude", String(coordinate.longitude)],
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
      [10.44, 123.97],
      [10.44, 123.99],
      [10.46, 123.99],
      [10.46, 123.97],
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
  await expect(page).toHaveURL(/\/admin\/locations\/[^/]+\/fulfillment$/);
  const locationId = new URL(page.url()).pathname.split("/")[3];
  expect(locationId).toBeTruthy();
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

  await page.goto("/admin/locations/service-areas");
  await page.getByLabel("Preview latitude", { exact: true }).fill(String(coordinate.latitude));
  await page.getByLabel("Preview longitude", { exact: true }).fill(String(coordinate.longitude));
  await page.getByRole("button", { name: "Preview routing", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(name);

  // Only transient search is synthetic. Confirmation and routing use the actual
  // Core commands with the test-only permanent geocoder transport.
  const candidate = {
    candidateKey: "synthetic-new-site-entrance",
    displayAddress: "Test new-site entrance, Cebu",
    coordinate,
    components: {
      addressLine1: "Test new-site entrance",
      addressLine2: null,
      barangay: null,
      city: "Cebu",
      region: "Cebu",
      postalCode: null,
      countryCode: "PH",
    },
    accuracy: "rooftop",
  };
  await customer.route("**/api/commerce/address-search", (route) =>
    route.fulfill({
      json: { ok: true, value: [candidate], requestId: "synthetic-geocoder" },
    }),
  );
  await customer.setViewportSize({ width: 390, height: 950 });
  await customer.goto("/");
  const dialog = customer.getByRole("dialog", { name: "Choose delivery address", exact: true });
  await dialog.getByRole("textbox", { name: /^Search for an address/ }).fill("Test new-site");
  await dialog.getByRole("button", { name: candidate.displayAddress, exact: true }).click();
  await expect(dialog.getByText("Delivery is available", { exact: true })).toBeVisible();
  let confirmation: unknown;
  await customer.route("**/api/commerce/browsing-location", async (route) => {
    const response = await route.fetch();
    confirmation = await response.json();
    await route.fulfill({ response });
  });
  await dialog.getByRole("button", { name: "Deliver here", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(confirmation).toMatchObject({
    ok: true,
    value: {
      coordinate: candidate.coordinate,
      serviceability: { serviceable: true, fulfillmentLocation: { id: locationId, name } },
    },
  });
  await expect(
    customer.getByRole("button", { name: "Choose delivery address", exact: true }),
  ).toContainText("Confirmed delivery entrance");
  await customer.screenshot({
    path: testInfo.outputPath("customer-site-selected.png"),
    fullPage: true,
  });
});
