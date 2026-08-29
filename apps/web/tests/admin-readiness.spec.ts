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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in required");
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toHaveCount(0);
});

test("authenticated shell supports keyboard focus, menu focus return, and responsive navigation", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_AUTH_EMAIL_CONFIGURED !== "1",
    "Authenticated Admin shell checks require the provisioned local auth-email transport.",
  );
  await page.route("**/api/admin/context", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "readiness-e2e",
        value: {
          staffId: "staff-readiness",
          displayName: "Readiness Operator",
          email: "readiness@example.com",
          capabilities: ["analytics.read"],
          scopes: [{ kind: "global" }],
          navigation: [{ code: "overview", label: "Overview", href: "/admin" }],
          environment: "test",
        },
      }),
    }),
  );
  await page.route("**/api/admin/scopes", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, requestId: "readiness-e2e", value: [] }),
    }),
  );
  await page.route("**/api/admin/operations", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "readiness-e2e",
        value: {
          locationId: "location-test",
          sectionsDenied: [],
          fulfillment: [],
          delivery: [],
          procurement: [],
          exceptions: [],
        },
      }),
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  const trigger = page.getByRole("button", { name: "Open admin navigation" });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveClass(/focus-visible:ring-2/);
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close admin navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close admin navigation" }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Mobile admin navigation" })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
  const overview = page.getByRole("link", { name: "Overview" }).first();
  await expect(overview).toHaveAttribute("aria-current", "page");
  await overview.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(overview).toBeFocused();
  await expect(page.getByRole("status", { name: "Clear" })).toBeVisible();
});
