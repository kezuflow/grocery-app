import { executeAdminE2eSql, expect, test } from "./admin-authenticated-fixture";
import { installAdminBootstrapFixture } from "./admin-bootstrap-fixture";

/**
 * Admin operations board flow against a provisioned local stack. Skips when
 * the app is unreachable so repository verification stays environment-safe.
 * Authenticated journeys use the deterministic local Staff fixture.
 */

let stackUp = false;
test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get("/");
    stackUp = response.status() < 500;
  } catch {
    stackUp = false;
  }
});
test.beforeEach(async () => {
  test.skip(!stackUp, "Local stack is not running; start web+core to execute E2E flows.");
});

test("an unauthenticated visitor is told to sign in with a staff account", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("operational workspaces retain the protected admin boundary", async ({ page }) => {
  for (const path of [
    "/admin/procurement",
    "/admin/receiving",
    "/admin/fulfillment",
    "/admin/delivery",
    "/admin/settings/fulfillment-mode",
    "/admin/issues/operational-exceptions",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("alert")).toContainText("staff account");
  }
});

test("a signed-in account without operational capability sees the denied state", async ({
  deniedAdminPage,
}) => {
  await deniedAdminPage.goto("/admin/procurement");
  const scopeControl = deniedAdminPage.getByRole("combobox", { name: "Active admin scope" });
  if ((await scopeControl.evaluate((control) => control.tagName)) === "SELECT") {
    await scopeControl.selectOption({ label: "Central Cebu" });
  } else {
    await scopeControl.click();
    await deniedAdminPage
      .getByRole("option", { name: "Central Cebu" })
      .evaluate((option) => (option as HTMLElement).click());
  }
  await expect(deniedAdminPage.getByRole("alert")).toContainText(
    "Procurement access is not permitted for this scope.",
  );
});

test("a provisioned Staff reader opens the real Procurement workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/procurement");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Procurement" })).toBeVisible();
});

test("selling pause, mode switch, and reopen succeed with capability and deny unauthorized staff", async ({
  adminPage,
  deniedAdminPage,
}) => {
  const now = Date.now();
  executeAdminE2eSql(`
    UPDATE global_commerce_configuration
    SET selling_state='OPEN', fulfillment_mode='INSTANT', cadence=NULL, version=1, updated_at=${now}
    WHERE id='global';
  `);
  await adminPage.goto("/admin/settings/fulfillment-mode");
  await expect(adminPage.getByText("OPEN", { exact: true })).toBeVisible();
  await adminPage.getByLabel("Commerce change reason").fill("Prepare scheduled operations");
  await adminPage.getByRole("button", { name: "Pause selling" }).click();
  await expect(adminPage.getByText("Selling paused.", { exact: true })).toBeVisible();

  await adminPage.getByLabel("Global fulfillment mode").selectOption("SCHEDULED");
  await adminPage.getByLabel("Commerce change reason").fill("Scheduled window is ready");
  await adminPage.getByRole("button", { name: "Activate global mode" }).click();
  await expect(
    adminPage.getByText("Global fulfillment mode saved.", { exact: true }),
  ).toBeVisible();

  await adminPage.getByLabel("Commerce change reason").fill("Resume scheduled checkout");
  await adminPage.getByRole("button", { name: "Reopen selling" }).click();
  await expect(adminPage.getByText("Selling reopened.", { exact: true })).toBeVisible();

  const denied = await deniedAdminPage.request.post("/api/admin/commerce-configuration", {
    data: {
      action: "PAUSE",
      expectedVersion: 4,
      reason: "Unauthorized attempt",
    },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});

test("exception workspace renders typed source fields and unavailable actions", async ({
  page,
}) => {
  await installAdminBootstrapFixture(page, {
    context: {
      staffId: "staff-e2e",
      displayName: "E2E",
      email: "e2e@example.com",
      capabilities: ["fulfillment.manage"],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
      navigation: [],
      environment: "test",
    },
    scopes: [
      {
        kind: "location",
        marketId: "market-e2e",
        marketCode: "CEBU",
        locationId: "location-cebu-central",
        locationCode: "CENTRAL",
        locationName: "Central Cebu",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
    ],
    selectedScope: {
      kind: "LOCATION",
      marketId: "market-e2e",
      locationId: "location-cebu-central",
    },
    timezone: "Asia/Manila",
  });
  await page.route("**/api/admin/exceptions**", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "e2e",
        value: {
          nextCursor: null,
          items: [
            {
              kind: "RECEIVING_DISCREPANCY",
              source: "RECEIVING",
              severity: "HIGH",
              ageMinutes: null,
              ownerId: null,
              referenceId: "receiving-e2e",
              orderId: null,
              locationId: "location-cebu-central",
              reason: "RECEIVING_DISCREPANCY",
              permittedActions: [],
              detail: "Expected 10, accepted 8, rejected 2.",
            },
          ],
        },
      }),
    }),
  );
  await page.goto("/admin/issues/operational-exceptions");
  await expect(page.getByText("RECEIVING").first()).toBeVisible();
  await expect(page.getByText("Source-owned; unavailable here")).toBeVisible();
  await expect(page.getByText("Age unavailable")).toBeVisible();
});
