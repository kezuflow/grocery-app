import { expect, test } from "@playwright/test";

/**
 * Finance workspace smoke coverage. Authenticated journeys remain gated until
 * a development staff identity and email transport are provisioned.
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

test("an unauthenticated visitor cannot open finance workspaces", async ({ page }) => {
  await page.goto("/admin/orders");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("an unauthenticated visitor cannot open membership or issue workspaces", async ({ page }) => {
  await page.goto("/admin/memberships");
  await expect(page.getByRole("alert")).toContainText("staff account");
  await page.goto("/admin/issues");
  await expect(page.getByRole("alert")).toContainText("staff account");
});
