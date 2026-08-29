import { expect, test } from "@playwright/test";

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
  test.skip(!stackUp, "Local stack is not running; start web+core to execute readiness flows.");
});

test("unauthenticated Admin state has a labelled heading and alert", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("main")).toHaveAccessibleName("Sign in required");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in required");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("unauthenticated workspace state does not expose navigation", async ({ page }) => {
  await page.goto("/admin/orders");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toHaveCount(0);
});

test("authenticated keyboard and mobile assertions remain gated by auth email transport", async () => {
  test.skip(
    process.env.E2E_AUTH_EMAIL_CONFIGURED !== "1",
    "Authenticated Admin shell checks require the provisioned local auth-email transport.",
  );
});
