import { expect, test } from "@playwright/test";

/**
 * Staff & Access workspace flows against a provisioned local stack. Skips
 * when the app is unreachable. Authenticated journeys require a configured
 * development auth-email transport (E2E_AUTH_EMAIL_CONFIGURED=1); the
 * auth-email port is fail-closed by design, so those gates remain explicitly
 * unmet until provisioning exists.
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

test("an unauthenticated visitor cannot open the staff workspace", async ({ page }) => {
  await page.goto("/admin/staff");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("an unauthenticated visitor cannot open the roles workspace", async ({ page }) => {
  await page.goto("/admin/staff/roles");
  await expect(page.getByRole("alert")).toContainText("staff account");
});
