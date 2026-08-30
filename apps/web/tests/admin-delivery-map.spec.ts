import { expect, test } from "./admin-authenticated-fixture";

test.describe.configure({ mode: "serial" });

test("authenticated dispatch remains table-operable without Mapbox and recovers from stale assignment", async ({
  adminPage,
}) => {
  const page = adminPage;
  let mapLoads = 0;
  let batchAttempts = 0;
  const submitted: Array<{ body: Record<string, unknown>; key: string | null }> = [];
  const pins = [
    {
      jobId: "job-1",
      orderId: "order-1",
      batchId: null,
      coordinate: { longitude: 123.885, latitude: 10.315 },
      fulfillmentMode: "INSTANT",
      cycleId: null,
      status: "UNASSIGNED",
      rider: null,
      version: 2,
      selection: { selectable: true, reason: null },
    },
    {
      jobId: "job-2",
      orderId: "order-2",
      batchId: null,
      coordinate: { longitude: 123.89, latitude: 10.32 },
      fulfillmentMode: "INSTANT",
      cycleId: null,
      status: "RETRY_SCHEDULED",
      rider: null,
      version: 5,
      selection: { selectable: true, reason: null },
    },
    {
      jobId: "job-assigned",
      orderId: "order-assigned",
      batchId: "batch-old",
      coordinate: null,
      fulfillmentMode: "INSTANT",
      cycleId: null,
      status: "ASSIGNED",
      rider: { riderId: "rider-1", displayName: "Rider One" },
      version: 7,
      selection: { selectable: false, reason: "Already assigned" },
    },
  ];

  await page.route("https://api.mapbox.com/**", (route) => route.abort());
  await page.route("**/api/admin/delivery-map?*", async (route) => {
    mapLoads += 1;
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          locationId: url.searchParams.get("locationId"),
          fulfillmentMode: "INSTANT",
          cycleId: null,
          pins,
          generatedAt: "2026-08-30T00:00:00.000Z",
        },
        requestId: `map-${mapLoads}`,
      }),
    });
  });
  await page.route("**/api/admin/delivery-batches?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: [
          { riderId: "rider-1", displayName: "Rider One", openBatchCount: 1, openDeliveryCount: 3 },
        ],
        requestId: "riders-1",
      }),
    }),
  );
  await page.route("**/api/admin/delivery-map/route-preview", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          outcome: "WARNING",
          geometry: null,
          totalMeters: null,
          totalSeconds: null,
          legs: [],
          warning: { code: "ROUTE_UNAVAILABLE", message: "Deterministic preview warning" },
        },
        requestId: "preview-1",
      }),
    });
  });
  await page.route("**/api/admin/delivery-batches", async (route) => {
    const request = route.request();
    submitted.push({
      body: request.postDataJSON() as Record<string, unknown>,
      key: request.headers()["idempotency-key"] ?? null,
    });
    batchAttempts += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        batchAttempts === 1
          ? { ok: true, value: { batchId: "batch-created" }, requestId: "batch-success" }
          : {
              ok: false,
              error: {
                code: "STALE_VERSION",
                message: "Delivery changed",
                requestId: "batch-stale",
              },
            },
      ),
    });
  });

  await page.goto("/admin/delivery");
  const scope = page.getByLabel("Active admin scope");
  await expect(scope).toBeVisible();
  const locationValue = await scope
    .locator("option")
    .evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .find((value) => value.includes('"LOCATION"')),
    );
  test.skip(
    !locationValue,
    "The deterministic Admin fixture exposed no fulfillment location option.",
  );
  await scope.selectOption(locationValue!);

  await expect(page.getByRole("heading", { name: "Delivery dispatch map" })).toBeVisible();
  await expect(page.getByText("Map configuration is unavailable")).toBeVisible();
  await expect(page.getByText("job-assigned", { exact: true })).toBeVisible();
  await expect(page.getByText("Already assigned", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select job-assigned" })).toBeDisabled();

  await page.getByRole("checkbox", { name: "Select job-1" }).click();
  await page.getByRole("checkbox", { name: "Select job-2" }).click();
  await page.getByRole("button", { name: "Move job-2 up" }).click();
  await page.getByRole("button", { name: "Preview route" }).click();
  await expect(page.getByText("Deterministic preview warning", { exact: true })).toBeVisible();
  await page.getByLabel("Eligible Rider").selectOption("rider-1");
  await page.getByRole("button", { name: "Review batch" }).click();
  await expect(page.getByRole("dialog")).toContainText("job-2");
  await page.getByRole("button", { name: "Confirm create and assign" }).click();
  await expect(
    page.getByText("Batch batch-created was created and assigned.", { exact: true }),
  ).toBeVisible();

  expect(submitted[0]?.body).toMatchObject({
    fulfillmentMode: "INSTANT",
    cycleId: null,
    riderId: "rider-1",
    orderedDeliveries: [
      { jobId: "job-2", expectedVersion: 5 },
      { jobId: "job-1", expectedVersion: 2 },
    ],
  });
  expect(submitted[0]?.key).toBeTruthy();
  expect(JSON.stringify(submitted[0]?.body)).not.toMatch(
    /coordinate|origin|optimi|address|phone|contact/i,
  );
  await expect(page.getByText("0/24 stops").first()).toBeVisible();

  await page.getByRole("checkbox", { name: "Select job-1" }).click();
  await page.getByLabel("Eligible Rider").selectOption("rider-1");
  await page.getByRole("button", { name: "Review batch" }).click();
  await page.getByRole("button", { name: "Confirm create and assign" }).click();
  await expect(page.getByText(/Authoritative deliveries were refreshed/)).toBeVisible();
  await expect(page.getByText("0/24 stops").first()).toBeVisible();
  expect(mapLoads).toBeGreaterThanOrEqual(3);
});
