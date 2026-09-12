import { expect, test, executeAdminE2eSql } from "./admin-authenticated-fixture";
import type { Page } from "@playwright/test";

async function checkPanel(page: Page, customer = false) {
  const bell = page.getByRole("button", { name: "Open notifications", exact: true });
  await bell.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(panel).toBeVisible();
  if (customer) {
    await expect(panel.getByRole("heading", { name: "Notifications" })).toBeFocused();
    await expect(panel.getByRole("button", { name: "Close notifications" })).toHaveCount(0);
    await expect(panel.locator("time")).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Close notifications" })).toBeFocused();
  }
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Missing panel bounds");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Missing viewport");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await expect(panel.getByRole("link").first()).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();
  await bell.click();
  await expect(panel).toBeVisible();
  const header = page.locator("header").first();
  const headerBox = await header.boundingBox();
  if (!headerBox) throw new Error("Missing header bounds");
  // Use the clear top edge, away from rounded corners and header controls.
  await header.click({ position: { x: headerBox.width / 2, y: 2 } });
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 390]) {
  test(`customer notifications use local owned facts and accessible panel at ${width}px`, async ({
    signedInPage: page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/orders");
    await page.getByRole("button", { name: "Open notifications", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Notifications" }).getByText("No updates yet"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const session = (await (await page.request.get("/api/auth/get-session")).json()) as {
      user: { id: string };
    };
    const authId = session.user.id.replaceAll("'", "''");
    const order = `notice-e2e-${crypto.randomUUID()}`;
    const now = Date.now();
    executeAdminE2eSql(`INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) SELECT 'payment-${order}',id,100,'PHP','SUCCEEDED','mock','${order}',${now},${now} FROM customer WHERE auth_user_id='${authId}';
      INSERT INTO grocery_order(id,customer_id,payment_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,created_at,committed_at,order_number) SELECT '${order}',id,'payment-${order}','INSTANT','{}','COMMITTED',100,'PHP',${now},${now},'FM-${order}' FROM customer WHERE auth_user_id='${authId}';`);
    await page.getByRole("button", { name: "Open notifications", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel.getByText("Order confirmed", { exact: true })).toBeVisible();
    await expect(panel.locator(`a[href="/orders/${order}"]`)).toBeVisible();
    await page.screenshot({
      path: `test-results/customer-notifications-${width}.png`,
      fullPage: false,
    });
    await page.keyboard.press("Escape");
    await checkPanel(page, true);
    await page.getByRole("button", { name: "Open notifications", exact: true }).click();
    await panel.locator(`a[href="/orders/${order}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${order}$`));
    await expect(panel).toBeHidden();
  });

  test(`Admin notifications share scoped Overview and support dismissal at ${width}px`, async ({
    adminPage: page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText("Open orders", { exact: true })).toBeVisible();
    await checkPanel(page);
    await page.getByRole("button", { name: "Open notifications", exact: true }).click();
    await page.screenshot({
      path: `test-results/admin-notifications-${width}.png`,
      fullPage: false,
    });
    await expect(
      page
        .getByRole("dialog", { name: "Notifications" })
        .getByRole("link", { name: "View overview" }),
    ).toBeVisible();
  });
}

test("anonymous customer sees sign-in and cannot read private notifications", async ({ page }) => {
  const result = await page.request.get("/api/commerce/notifications?customerId=forged");
  expect(result.status()).toBe(401);
  expect(result.headers()["cache-control"]).toContain("no-store");
  await page.goto("/orders");
  await page.getByRole("button", { name: "Open notifications", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(panel.getByText("Order confirmed", { exact: true })).toHaveCount(0);
});

test("mobile customer handles failed reads and a long bounded list", async ({
  signedInPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  let fail = true;
  await page.route("**/api/commerce/notifications", (route) =>
    route.fulfill({
      status: fail ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        fail
          ? { ok: false, error: { code: "INTERNAL_ERROR", requestId: "fixture" } }
          : {
              ok: true,
              value: {
                hasMore: true,
                items: Array.from({ length: 24 }, (_, index) => ({
                  type: "DELIVERY_FAILED",
                  label: "Delivery failed  -  please contact support about your order",
                  reference: `FM-${"long-reference".repeat(8)}-${index}`,
                  occurredAt: "2026-09-13T00:00:00.000Z",
                  href: "/orders",
                  actionLabel: "View order",
                })),
              },
            },
      ),
    }),
  );
  await page.goto("/orders");
  await page.getByRole("button", { name: "Open notifications", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByRole("alert")).toBeVisible();
  fail = false;
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(24);
  await panel.getByRole("link", { name: "View all orders" }).scrollIntoViewIfNeeded();
  await expect(panel.getByRole("link", { name: "View all orders" })).toBeVisible();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/customer-notifications-320-long.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open notifications", exact: true })).toBeFocused();
});
