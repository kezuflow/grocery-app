import type { Page } from "@playwright/test";
import type { AdminNavigationItem, OperationalExceptionItem } from "@freshmarkets/contracts";
import { expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

const locations = ["location-cebu-central", "location-cebu-north"] as const;
const navigation: AdminNavigationItem[] = [
  {
    code: "fulfillment",
    label: "Fulfillment",
    href: "/admin/fulfillment",
    section: "orders",
    scopeKinds: ["LOCATION"],
    parentCode: null,
    kind: "workspace",
  },
  {
    code: "delivery",
    label: "Delivery",
    href: "/admin/delivery",
    section: "orders",
    scopeKinds: ["LOCATION"],
    parentCode: null,
    kind: "workspace",
  },
  {
    code: "procurement",
    label: "Delivery weeks",
    href: "/admin/procurement",
    section: "orders",
    scopeKinds: ["GLOBAL", "LOCATION"],
    parentCode: null,
    kind: "workspace",
  },
];
function exception(overrides: Partial<OperationalExceptionItem> = {}): OperationalExceptionItem {
  return {
    kind: "FULFILLMENT_SHORTAGE",
    source: "FULFILLMENT",
    severity: "HIGH",
    ageMinutes: 12,
    ownerId: null,
    referenceId: "shortage-1",
    orderId: "order-1",
    locationId: locations[0],
    reason: "FULFILLMENT_SHORTAGE",
    permittedActions: ["RETRY_FULFILLMENT"],
    detail: "A source-owned shortage needs review.",
    ...overrides,
  };
}
function success(items: OperationalExceptionItem[], nextCursor: string | null = null) {
  return { ok: true, requestId: "exceptions-e2e", value: { items, nextCursor } };
}
async function installFixture(
  page: Page,
  entries = navigation,
  capabilities: Array<"fulfillment.manage" | "fulfillment.read" | "delivery.read"> = [
    "fulfillment.manage",
    "fulfillment.read",
    "delivery.read",
  ],
) {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-exceptions",
      displayName: "Exceptions",
      email: "exceptions@example.com",
      capabilities,
      scopes: locations.map((locationId) => ({ kind: "location" as const, locationId })),
      navigation: entries,
      environment: "test",
    },
    scopes: locations.map((locationId, index) => ({
      kind: "location" as const,
      marketId: "market-cebu",
      marketCode: "CEBU",
      locationId,
      locationCode: index ? "NORTH" : "CENTRAL",
      locationName: index ? "North Cebu" : "Central Cebu",
      currency: "PHP",
      timezone: "Asia/Manila",
    })),
    selectedScope: { kind: "LOCATION", marketId: "market-cebu", locationId: locations[0] },
    timezone: "Asia/Manila",
  });
}
async function selectScope(page: Page, label: string) {
  const control = page.getByRole("combobox", { name: "Active admin scope" });
  if ((await control.evaluate((element) => element.tagName)) === "SELECT") {
    await control.selectOption({ label });
  } else {
    await control.click();
    await page
      .getByRole("option", { name: label })
      .evaluate((option) => (option as HTMLElement).click());
  }
}

let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    stackUp = (await request.get("/")).status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async () => {
  test.skip(!stackUp, "Local stack is not running; start web+core for browser acceptance.");
});

test("links only to authorized source workspaces with exact order context", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installFixture(page);
  await page.route("**/api/admin/exceptions?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        success([
          exception(),
          exception({
            kind: "DELIVERY_FAILED",
            source: "DELIVERY",
            referenceId: "delivery-1",
            orderId: "order/2",
            reason: "DELIVERY_FAILED",
            permittedActions: ["RETRY_DELIVERY"],
            detail: "A delivery attempt needs review.",
          }),
          exception({
            kind: "PROCUREMENT_SHORTAGE",
            source: "PROCUREMENT",
            referenceId: "supply-1",
            orderId: null,
            reason: "PROCUREMENT_SHORTAGE",
            permittedActions: ["ALTERNATE_SOURCE"],
            detail: "A supply requirement needs review.",
          }),
          exception({
            kind: "RECEIVING_DISCREPANCY",
            source: "RECEIVING",
            referenceId: "receipt-1",
            orderId: null,
            reason: "RECEIVING_DISCREPANCY",
            permittedActions: [],
            detail: "Received quantity differs from the manifest.",
          }),
        ]),
      ),
    }),
  );
  await page.goto("/admin/issues/operational-exceptions");
  await expect(page.getByRole("link", { name: "Open fulfillment" })).toHaveAttribute(
    "href",
    "/admin/fulfillment?orderId=order-1",
  );
  await expect(page.getByRole("link", { name: "Open delivery" })).toHaveAttribute(
    "href",
    "/admin/delivery?orderId=order%2F2",
  );
  await expect(page.getByRole("link", { name: "Open procurement" })).toHaveAttribute(
    "href",
    "/admin/procurement",
  );
  await expect(page.getByText("Source link unavailable")).toHaveCount(1);
  await expect(page.getByText("Retry fulfillment").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry fulfillment" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("operational-exceptions-1440.png") });
});

test("keeps the current cursor and visible rows during shared refresh, then reports a delayed read", async ({
  page,
}) => {
  await installFixture(page);
  let activityRevision = 0;
  let failRefresh = false;
  await page.route("**/api/admin/operations-activity?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "activity-e2e",
        value: { notifications: [], latest: activityRevision++ },
      }),
    }),
  );
  await page.route("**/api/admin/exceptions?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        failRefresh && cursor === "next"
          ? {
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                message: "Read temporarily unavailable",
                requestId: "retry",
              },
            }
          : cursor === "next"
            ? success([exception({ referenceId: "second-page" })])
            : success([exception({ referenceId: "first-page" })], "next"),
      ),
    });
  });
  await page.goto("/admin/issues/operational-exceptions");
  await page
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.getByText("second-page")).toBeVisible();
  failRefresh = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Read temporarily unavailable")).toBeVisible();
  await expect(page.getByText("second-page")).toBeVisible();
  await expect(page.getByText("Page 2")).toBeVisible();
});

test("scope change hides old rows and ignores an in-flight result from the prior location", async ({
  page,
}) => {
  await installFixture(page);
  await page.route("**/api/admin/operations-activity?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "activity-e2e",
        value: { notifications: [], latest: null },
      }),
    }),
  );
  const delayedOld: { release?: () => void } = {};
  let oldReads = 0;
  await page.route("**/api/admin/exceptions?**", async (route) => {
    const locationId = new URL(route.request().url()).searchParams.get("locationId");
    if (locationId === locations[0] && ++oldReads > 1) {
      await new Promise<void>((resolve) => {
        delayedOld.release = resolve;
      });
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        success([
          exception({
            referenceId: locationId === locations[0] ? "old-location" : "new-location",
            locationId,
          }),
        ]),
      ),
    });
  });
  await page.goto("/admin/issues/operational-exceptions");
  await expect(page.getByText("old-location")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => oldReads).toBeGreaterThan(1);
  await selectScope(page, "North Cebu");
  await expect(page.getByText("old-location")).toHaveCount(0);
  await expect(page.getByText("new-location")).toBeVisible();
  delayedOld.release?.();
  await expect(page.getByText("old-location")).toHaveCount(0);
});

test("notification first failure exposes retry in the desktop bell", async ({ page }) => {
  await installFixture(page, navigation, ["fulfillment.manage"]);
  let exceptionReads = 0;
  await page.route("**/api/admin/exceptions?**", (route) => {
    exceptionReads += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(success([])) });
  });
  await page.route("**/api/admin/operations-activity?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "FORBIDDEN", message: "Activity unavailable", requestId: "activity" },
      }),
    }),
  );
  await page.goto("/admin/issues/operational-exceptions");
  await page.getByRole("button", { name: "Open notifications" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "couldn’t load your notifications",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => exceptionReads).toBeGreaterThan(1);
});

test("real local Core authorizes the location queue and denies staff without capability", async ({
  adminPage,
  deniedAdminPage,
}) => {
  const path = `/api/admin/exceptions?locationId=${locations[0]}&limit=50`;
  const allowed = await adminPage.request.get(path);
  expect(await allowed.json()).toMatchObject({ ok: true, value: { items: expect.any(Array) } });
  const denied = await deniedAdminPage.request.get(path);
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  await adminPage.goto("/admin/issues/operational-exceptions");
  await expect(adminPage.getByText("Select a permitted location")).toBeVisible();
  await selectScope(adminPage, "Central Cebu");
  await expect(adminPage.getByRole("heading", { name: "Exception queue" })).toBeVisible();
});
