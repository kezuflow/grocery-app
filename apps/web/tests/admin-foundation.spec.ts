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
  const navigation = adminPage.getByRole("dialog", { name: "Admin navigation" });
  await expect(navigation).toBeVisible();
  const overview = navigation.locator('a[href="/admin"]');
  await expect(overview).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: "Product list" }).click();
  await expect(navigation).toBeHidden();
  await expect(adminPage).toHaveURL(/\/admin\/catalog\/products$/);
  await trigger.focus();
  await trigger.press("Enter");
  await expect(
    adminPage.getByRole("dialog", { name: "Admin navigation" }).getByRole("link", {
      name: "Product list",
    }),
  ).toHaveAttribute("aria-current", "page");
  await adminPage.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("the desktop shell defaults to an expanded sidebar and persists an explicit collapse preference", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("button", { name: "Collapse admin navigation" })).toBeVisible();
  await adminPage.getByRole("button", { name: "Collapse admin navigation" }).click();
  await adminPage.reload();
  await expect(adminPage.getByRole("button", { name: "Expand admin navigation" })).toBeVisible();
  await adminPage.getByRole("button", { name: "Expand admin navigation" }).click();
  await adminPage.reload();
  await expect(adminPage.getByRole("button", { name: "Collapse admin navigation" })).toBeVisible();
});

test("the desktop theme and search respect keyboard focus and reduced motion", async ({
  adminPage,
}, testInfo) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.emulateMedia({ reducedMotion: "reduce" });
  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await adminPage.screenshot({ path: testInfo.outputPath("admin-light-1440.png") });
  expect(
    await adminPage
      .locator(".fm-admin")
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("ui-sans-serif");
  const darkToggle = adminPage.getByRole("button", { name: "Switch to dark mode" });
  await darkToggle.click();
  await expect(adminPage.locator("html")).toHaveClass(/fm-admin-dark/);
  await expect(adminPage.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  expect(
    await adminPage
      .getByRole("button", { name: "Switch to light mode" })
      .locator("svg")
      .first()
      .evaluate((icon) => getComputedStyle(icon).transitionProperty),
  ).toBe("none");
  await adminPage.reload();
  await expect(adminPage.locator("html")).toHaveClass(/fm-admin-dark/);
  await expect(adminPage.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(adminPage.getByText("Open orders", { exact: true })).toBeVisible();
  await adminPage.screenshot({ path: testInfo.outputPath("admin-dark-1440.png") });

  const search = adminPage.getByRole("button", { name: "Open admin search" });
  await search.focus();
  await adminPage.keyboard.press("Control+k");
  const palette = adminPage.getByRole("dialog", { name: "Admin command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();
  expect(await palette.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await adminPage.screenshot({ path: testInfo.outputPath("admin-search-1440.png") });
  await adminPage.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(search).toBeFocused();

  const refresh = adminPage.getByRole("button", { name: "Refresh" });
  await refresh.focus();
  await adminPage.keyboard.press("Control+k");
  await expect(palette.getByRole("combobox")).toBeFocused();
  await adminPage.keyboard.press("Escape");
  await expect(refresh).toBeFocused();
});

test("scope changes keep the notification control in a stable header position", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin");
  const selector = adminPage.getByRole("combobox", { name: "Active admin scope" });
  const search = adminPage.getByRole("button", { name: "Open admin search" });
  const bell = adminPage.getByRole("button", { name: "Open notifications" });
  await expect(selector).toContainText("Global");
  const selectorBox = await selector.boundingBox();
  const searchBox = await search.boundingBox();
  const before = await bell.boundingBox();
  expect(selectorBox!.x + selectorBox!.width).toBeLessThan(searchBox!.x);
  expect(searchBox!.x + searchBox!.width).toBeLessThan(before!.x);
  await selector.click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(selector).toContainText("Central Cebu");
  const after = await bell.boundingBox();
  expect(before?.x).toBe(after?.x);

  await adminPage.setViewportSize({ width: 320, height: 844 });
  await expect(search).toBeHidden();
  await expect(selector).toBeVisible();
  const mobileSelector = await selector.boundingBox();
  const mobileBell = await bell.boundingBox();
  expect(mobileSelector!.x + mobileSelector!.width).toBeLessThan(mobileBell!.x);
});

test("a legacy Payments deep link opens the authorized canonical workspace", async ({
  adminPage,
}) => {
  await adminPage.goto("/admin/payments/transactions");
  await expect(adminPage).toHaveURL(/\/admin\/payments$/);
  await expect(adminPage.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(adminPage.getByRole("tablist", { name: "Payment views" })).toBeVisible();
});

test("Orders status filter supports keyboard selection and keeps its URL", async ({
  adminPage,
}) => {
  await adminPage.goto("/admin/orders");
  const status = adminPage.getByRole("combobox", { name: "Order status view" });
  await expect(status).toContainText("All");
  await status.press("Enter");
  await adminPage.getByRole("option", { name: "Committed" }).press("Enter");
  await expect(status).toContainText("Committed");
  await expect(adminPage).toHaveURL(/status=COMMITTED/);
});

test("Orders uses the compact shadcn index and responsive status controls", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin/orders");
  const orders = adminPage.locator(".fm-admin-orders");
  await expect(orders.locator('[data-slot="card"]')).toBeVisible();
  await expect(orders.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
  await expect(orders.getByRole("textbox", { name: "Filter orders on this page" })).toBeVisible();
  await expect(orders.getByText(/Showing \d+ of \d+ orders? on this page/)).toBeVisible();
  const previous = orders.getByRole("button", { name: "Previous" });
  await expect(previous).toBeVisible();
  await expect(previous).toHaveAttribute("data-slot", "button");
  expect(await previous.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("8px");
  await adminPage.setViewportSize({ width: 1100, height: 800 });
  await expect(orders.locator('[data-slot="card"]')).toBeVisible();
  await expect(orders.getByRole("combobox", { name: "Order status view" })).toBeVisible();
  await adminPage.setViewportSize({ width: 390, height: 844 });
  const status = orders.getByRole("combobox", { name: "Order status view" });
  await expect(status).toBeVisible();
  await status.click();
  await adminPage.getByRole("option", { name: "Committed" }).click();
  await expect(adminPage).toHaveURL(/status=COMMITTED/);
  expect(await adminPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
});

test("Payments uses the shared tabs and status select", async ({ adminPage }) => {
  await adminPage.goto("/admin/payments");
  const views = adminPage.getByRole("tablist", { name: "Payment views" });
  await expect(views.getByRole("tab", { name: "Payments" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await adminPage.getByRole("combobox", { name: "Status" }).click();
  await adminPage.getByRole("option", { name: "Paid", exact: true }).click();
  await expect(adminPage).toHaveURL(/status=paid/);
  await views.getByRole("tab", { name: /Needs attention/ }).click();
  await expect(views.getByRole("tab", { name: /Needs attention/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("stock Admin theme tokens stay isolated from the storefront", async ({ adminPage, page }) => {
  await adminPage.goto("/admin");
  const adminAccent = await adminPage
    .locator(".fm-admin")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("--fm-admin-accent").trim());
  const adminFont = await adminPage
    .locator(".fm-admin")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  await page.goto("/");
  const storefrontAccent = await page
    .locator(".fm-storefront")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("--fm-admin-accent").trim());
  const storefrontFont = await page
    .locator(".fm-storefront")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(adminAccent).not.toBe("");
  expect(adminFont).toContain("ui-sans-serif");
  expect(storefrontAccent).toBe("");
  expect(storefrontFont).toContain("Geist Variable");
});

test("a signed-in non-staff account sees the forbidden state with recovery guidance", async ({
  signedInPage,
}) => {
  await signedInPage.goto("/admin");
  await expect(signedInPage.getByText(/not an active staff principal/i)).toBeVisible();
});
