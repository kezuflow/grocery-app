import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

test("Point of Sale prepares a paid order through the scoped Fulfillment command", async ({
  page,
}) => {
  const locationId = "location-cebu-central";
  let status = "NOT_STARTED";
  let command: Record<string, unknown> | null = null;
  let commandKey: string | null = null;

  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-pos",
      displayName: "Preparation Staff",
      email: "staff@example.com",
      capabilities: ["fulfillment.read", "fulfillment.manage"],
      scopes: [{ kind: "location", locationId }],
      navigation: [
        {
          code: "point-of-sale",
          label: "Point of Sale",
          href: "/admin/point-of-sale",
          section: "sales_channels",
          scopeKinds: ["LOCATION"],
          parentCode: null,
          kind: "workspace",
        },
      ],
      environment: "test",
    },
    scopes: [
      {
        kind: "location",
        marketId: "market-cebu",
        marketCode: "CEBU",
        locationId,
        locationCode: "CENTRAL",
        locationName: "Central Cebu",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
    ],
    selectedScope: { kind: "LOCATION", marketId: "market-cebu", locationId },
    timezone: "Asia/Manila",
  });
  await page.route("**/api/admin/operations-activity?**", (route) =>
    route.fulfill({
      json: { ok: true, requestId: "activity", value: { notifications: [], latest: null } },
    }),
  );
  await page.route("**/api/admin/fulfillment?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("locationId")).toBe(locationId);
    expect(query.get("filter")).toBe("ACTIVE");
    return route.fulfill({
      json: {
        ok: true,
        requestId: "queue",
        value: {
          items: [
            {
              orderId: "order-1",
              cycleId: null,
              locationId,
              status,
              version: status === "NOT_STARTED" ? 1 : 2,
              allowedActions: status === "NOT_STARTED" ? ["START_PICKING"] : ["MARK_READY_TO_PACK"],
              operational: {
                orderNumber: "FM-1001",
                committedAt: "2026-09-24T01:00:00.000Z",
                fulfillmentMode: "INSTANT",
                progress: status === "NOT_STARTED" ? "NEW" : "PREPARING",
                recipient: { name: "Ana", phone: "+639170000000" },
                timing: {
                  cycleName: null,
                  windowName: null,
                  startsAt: null,
                  endsAt: null,
                  pickupAt: null,
                  timezone: "Asia/Manila",
                },
                deliveryStatus: null,
                blockers: [],
                lines: [
                  {
                    lineId: "line-1",
                    source: "ORIGINAL",
                    productName: "Tomato",
                    variantName: "Roma",
                    unit: "kg",
                    quantity: 2,
                    baseQuantity: 2000,
                    baseUnit: "GRAM",
                    goods: {
                      kind: "INSTANT_RESERVATION",
                      status: "RESERVED",
                      allocatedBase: 2000,
                      receivedBase: null,
                    },
                  },
                ],
              },
            },
          ],
          nextCursor: null,
        },
      },
    });
  });
  await page.route("**/api/admin/fulfillment", async (route) => {
    command = route.request().postDataJSON() as Record<string, unknown>;
    commandKey = route.request().headers()["idempotency-key"] ?? null;
    status = "PICKING";
    await route.fulfill({ json: { ok: true, requestId: "command", value: {} } });
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/admin/point-of-sale");
  await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Point of Sale" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open order FM-1001" })).toBeVisible();
  await page.getByRole("button", { name: "Open order FM-1001" }).click();
  await expect(page.getByRole("heading", { name: "Ordered item checklist" })).toBeVisible();
  await page.screenshot({ path: "test-results/point-of-sale-tablet.png", fullPage: true });
  await page.getByRole("button", { name: "Accept order & start picking", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish picking" })).toBeVisible();
  expect(command).toMatchObject({
    locationId,
    orderId: "order-1",
    action: "START_PICKING",
    expectedVersion: 1,
  });
  expect(commandKey).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
  await page.screenshot({ path: "test-results/point-of-sale-phone.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Back to orders" }).click();
  await expect(page.getByRole("button", { name: "Open order FM-1001" })).toBeVisible();
});
