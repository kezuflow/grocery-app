import { expect, test, executeAdminE2eSql } from "./admin-authenticated-fixture";

test.describe.configure({ timeout: 180000 });
function seedPurchase() {
  const id = crypto.randomUUID();
  const buyer = crypto.randomUUID();
  const at = Date.now() - 3600000;
  const key = `home-${id}`;
  executeAdminE2eSql(`
    INSERT INTO customer(id,auth_user_id,created_at,updated_at) VALUES ('${buyer}','${buyer}',${at},${at});
    INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES ('${id}','GROCERY_CHECKOUT','checkout_quote','${id}','${buyer}',45000,'PHP','SUCCEEDED','${key}',1,${at},${at});
    INSERT INTO payment_attempt(id,customer_id,payment_intent_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('${id}','${buyer}','${id}',45000,'PHP','SUCCEEDED','canonical','${key}',${at},${at});
    INSERT INTO grocery_order(id,customer_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,created_at,order_number) VALUES ('${id}','${buyer}','INSTANT','{}','COMMITTED',45000,'PHP','${id}',${at},'HOME-${id.slice(0, 8)}');
    INSERT INTO order_fulfillment_snapshot(order_id,location_id,zone_id,fulfillment_mode,sourcing_modes_json,created_at) VALUES ('${id}','location-cebu-central','zone-cebu-city-core','INSTANT','["STOCKED"]',${at});
    INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at) VALUES ('${id}','${id}','${id}','${id}',${at});
    INSERT INTO payment_reaction(id,payment_intent_id,reaction_type,subject_type,subject_id,status,idempotency_key,created_at,updated_at) VALUES ('${id}','${id}','COMMIT_ORDER','checkout_quote','${id}','SUCCEEDED','${key}',${at},${at});
    INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity) VALUES ('${id}','${id}','home-beans','String beans','1 kg','kg',3,15000,45000,3000);
  `);
  return id;
}
for (const viewport of [
  { name: "desktop", width: 1440, height: 1200 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Home uses actual commerce reads and switches periods on ${viewport.name}`, async ({
    adminPage: page,
  }) => {
    const orderId = seedPurchase();
    await page.setViewportSize(viewport);
    await page.goto("/admin");
    await expect(page.getByText("Total revenue", { exact: true })).toBeVisible();
    await expect(page.getByText("Monthly revenue", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: `HOME-${orderId.slice(0, 8)}` }).first(),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "String beans 1 kg · kg" })).toBeVisible();
    await page.getByRole("combobox", { name: "Overview period" }).click();
    const response = page.waitForResponse((r) => r.url().includes("commercePeriod=7d"));
    await page.getByRole("option", { name: "Last 7 days", exact: true }).click();
    const payload = await (await response).json();
    expect(payload).toMatchObject({
      ok: true,
      value: { commerce: { period: "7d", revenue: { value: expect.any(Number) } } },
    });
    await expect(page.getByText("Total revenue", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "New users", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Total revenue", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Overview period" })).toHaveText("Last 7 days");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `../../.wrangler/home-commerce-${viewport.name}-top.png` });
    await page.screenshot({
      path: `../../.wrangler/home-commerce-${viewport.name}.png`,
      fullPage: true,
    });
  });
}
test("Home preserves commerce errors and denies non-analytics readers", async ({
  adminPage: page,
  catalogReadOnlyPage: reader,
}) => {
  await page.route("**/api/admin/overview?**", async (route) => {
    if (!route.request().url().includes("commercePeriod=")) return route.continue();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Dashboard read failed",
          requestId: "home-read-error",
        },
      }),
    });
  });
  await page.goto("/admin");
  await expect(page.getByText(/Dashboard read failed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await page.unroute("**/api/admin/overview?**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Total revenue", { exact: true })).toBeVisible();
  await reader.goto("/admin");
  await expect(reader.getByText(/Analytics access is required/)).toBeVisible();
  await expect(reader.getByText("Total revenue", { exact: true })).toHaveCount(0);
});
