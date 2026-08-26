import { expect, test } from "@playwright/test";

/**
 * Rider console flow against a provisioned local stack. Skips when the app
 * is unreachable so repository verification stays environment-safe.
 * Authenticated journeys additionally require a configured development
 * auth-email transport (E2E_AUTH_EMAIL_CONFIGURED=1).
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

async function signUpRider(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const email = `rider-e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: {
      "content-type": "application/json",
      origin: process.env.APP_BASE_URL ?? "http://localhost:8787",
    },
    data: { name: "Rider E2E", email, password: "correct-horse-battery-staple" },
  });
  expect([200, 201]).toContain(signUp.status());
}

test("an unauthenticated rider is told to sign in", async ({ page }) => {
  await page.goto("/rider");
  await expect(page.getByRole("alert")).toContainText("Sign in with your rider account");
});

test("a signed-in rider with no assignments sees the explicit empty state", async ({ page }) => {
  test.skip(!authEmailConfigured, "Signup verification needs a configured auth-email transport.");
  await signUpRider(page.request);
  await page.goto("/rider");
  await expect(page.getByText(/no deliveries are assigned to you/i)).toBeVisible();
});
