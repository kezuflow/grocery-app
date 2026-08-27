import { expect, test } from "@playwright/test";

/**
 * Admin foundation shell and Audit workspace flows against a provisioned
 * local stack. Skips when the app is unreachable so repository verification
 * stays environment-safe. Authenticated journeys additionally require a
 * configured development auth-email transport (E2E_AUTH_EMAIL_CONFIGURED=1);
 * the auth-email port is fail-closed by design until that provisioning exists.
 */
const authEmailConfigured = process.env.E2E_AUTH_EMAIL_CONFIGURED === "1";
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

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

async function signUpAccount(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const email = `admin-foundation-e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { "content-type": "application/json", origin: APP_BASE_URL },
    data: { name: "Admin Foundation E2E", email, password: "correct-horse-battery-staple" },
  });
  expect([200, 201]).toContain(signUp.status());
}

test("an unauthenticated visitor sees the sign-in requirement, not the shell", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("staff account");
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toHaveCount(0);
});

test("an unauthenticated visitor cannot open the Audit workspace", async ({ page }) => {
  await page.goto("/admin/audit");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("the mobile navigation trigger is keyboard and screen-reader accessible", async ({ page }) => {
  test.skip(!authEmailConfigured, "The shell mounts for provisioned staff sessions only.");
  await signUpAccount(page.request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  const trigger = page.getByRole("button", { name: "Open admin navigation" });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await expect(trigger).toBeFocused();
});

test("a signed-in non-staff account sees the forbidden state with recovery guidance", async ({
  page,
}) => {
  test.skip(!authEmailConfigured, "Signup verification needs a configured auth-email transport.");
  await signUpAccount(page.request);
  await page.goto("/admin");
  await expect(page.getByText(/not an active staff principal/i)).toBeVisible();
});
