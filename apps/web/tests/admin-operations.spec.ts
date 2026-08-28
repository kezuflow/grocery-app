import { expect, test } from "@playwright/test";

/**
 * Admin operations board flow against a provisioned local stack. Skips when
 * the app is unreachable so repository verification stays environment-safe.
 * Authenticated journeys additionally require a configured development
 * auth-email transport (E2E_AUTH_EMAIL_CONFIGURED=1); the delivery port is
 * fail-closed by design until that provisioning exists.
 */
const authEmailConfigured = process.env.E2E_AUTH_EMAIL_CONFIGURED === "1";

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

async function signUpStaff(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const email = `admin-e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: {
      "content-type": "application/json",
      origin: process.env.APP_BASE_URL ?? "http://localhost:3000",
    },
    data: { name: "Admin E2E", email, password: "correct-horse-battery-staple" },
  });
  expect([200, 201]).toContain(signUp.status());
}

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
  page,
}) => {
  test.skip(!authEmailConfigured, "Signup verification needs a configured auth-email transport.");
  await signUpStaff(page.request);
  await page.goto("/admin");
  await expect(
    page.getByText(/no operational capability|denied|sections not permitted/i).first(),
  ).toBeVisible();
});

test("exception workspace renders typed source fields and unavailable actions", async ({
  page,
}) => {
  await page.route("**/api/admin/context", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "e2e",
        value: {
          staffId: "staff-e2e",
          displayName: "E2E",
          email: "e2e@example.com",
          capabilities: ["fulfillment.manage"],
          scopes: [],
          navigation: [],
          environment: "test",
        },
      }),
    }),
  );
  await page.route("**/api/admin/scopes", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "e2e",
        value: [
          {
            kind: "location",
            marketId: "market-e2e",
            marketCode: "CEBU",
            locationId: "location-cebu-central",
            locationCode: "CENTRAL",
            locationName: "Cebu Central",
            currency: "PHP",
            timezone: "Asia/Manila",
          },
        ],
      }),
    }),
  );
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
