import { expect, test } from "./admin-authenticated-fixture";

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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in required");
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toHaveCount(0);
});

test("authenticated shell supports keyboard focus, menu focus return, and responsive navigation", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.goto("/admin");
  const trigger = adminPage.getByRole("button", { name: "Open admin navigation" });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveClass(/focus-visible:ring-2/);
  await trigger.click();
  await expect(adminPage.getByRole("dialog")).toBeVisible();
  await expect(adminPage.getByRole("button", { name: "Close admin navigation" })).toBeVisible();
  await adminPage.getByRole("button", { name: "Close admin navigation" }).click();
  await expect(trigger).toBeFocused();
  await expect(
    adminPage.getByRole("navigation", { name: "Mobile admin navigation" }),
  ).toBeVisible();

  await adminPage.setViewportSize({ width: 1280, height: 800 });
  await expect(adminPage.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
  const overview = adminPage.getByRole("link", { name: "Overview" }).first();
  await expect(overview).toHaveAttribute("aria-current", "page");
  await overview.focus();
  await adminPage.keyboard.press("Shift+Tab");
  await adminPage.keyboard.press("Tab");
  await expect(overview).toBeFocused();
  await expect(adminPage.getByRole("main")).toBeVisible();
});
