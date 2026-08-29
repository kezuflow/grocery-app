import { expect, test } from "./admin-authenticated-fixture";

/**
 * Admin foundation shell and Audit workspace flows against a provisioned
 * local stack. Skips when the app is unreachable so repository verification
 * stays environment-safe. Authenticated journeys additionally require a
 * deterministic local test fixture described in playwright.config.ts.
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

test("an unauthenticated visitor sees the sign-in requirement, not the shell", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("staff account");
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toHaveCount(0);
});

test("an unauthenticated visitor cannot open the Audit workspace", async ({ page }) => {
  await page.goto("/admin/audit");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("the authenticated mobile navigation is keyboard and screen-reader accessible", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.goto("/admin");
  const trigger = adminPage.getByRole("button", { name: "Open admin navigation" });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(adminPage.getByRole("dialog", { name: "Admin navigation" })).toBeVisible();
  await adminPage.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("the desktop shell persists its collapsed navigation preference", async ({ adminPage }) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin");
  const collapse = adminPage.getByRole("button", { name: "Collapse admin navigation" });
  await collapse.click();
  await expect(adminPage.getByRole("button", { name: "Expand admin navigation" })).toBeVisible();
  await adminPage.reload();
  await expect(adminPage.getByRole("button", { name: "Expand admin navigation" })).toBeVisible();
});

test("Core-authorized workspaces expose hierarchical breadcrumbs", async ({ adminPage }) => {
  await adminPage.goto("/admin/payments/transactions");
  const breadcrumb = adminPage.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb).toContainText("Payments");
  await expect(breadcrumb).toContainText("Transactions");
});

test("admin accent tokens stay isolated from the storefront", async ({ adminPage, page }) => {
  await adminPage.goto("/admin");
  const adminAccent = await adminPage
    .locator(".fm-admin")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("--fm-admin-accent").trim());
  await page.goto("/");
  const storefrontAccent = await page
    .locator(".fm-storefront")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("--fm-admin-accent").trim());
  expect(adminAccent).toBe("#f97316");
  expect(storefrontAccent).toBe("");
});

test("a signed-in non-staff account sees the forbidden state with recovery guidance", async ({
  signedInPage,
}) => {
  await signedInPage.goto("/admin");
  await expect(signedInPage.getByText(/not an active staff principal/i)).toBeVisible();
});
