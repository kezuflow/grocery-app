import { executeAdminE2eSql, expect, test } from "./admin-authenticated-fixture";

/**
 * Finance workspace smoke coverage with deterministic local Staff identities.
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

test("a provisioned Staff reader opens the real Orders workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/orders");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
});

test("a Staff principal without capability is denied the Orders workspace", async ({
  deniedAdminPage,
}) => {
  await deniedAdminPage.goto("/admin/orders");
  await expect(deniedAdminPage.getByRole("alert")).toContainText(/orders\.read.*required/i);
});

test("order cancellation succeeds with capability and is denied without it", async ({
  adminPage,
  deniedAdminPage,
}) => {
  const suffix = crypto.randomUUID();
  const now = Date.now();
  const userId = `user-${suffix}`;
  const principalId = `principal-${suffix}`;
  const customerId = `customer-${suffix}`;
  const paymentId = `payment-${suffix}`;
  const orderId = `order-${suffix}`;
  executeAdminE2eSql(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${userId}', 'Order Customer', '${suffix}@example.com', 1, ${now}, ${now});
    INSERT INTO customer_principal (id, auth_user_id, status, created_at, updated_at)
      VALUES ('${principalId}', '${userId}', 'active', ${now}, ${now});
    INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at)
      VALUES ('${customerId}', '${userId}', '${principalId}', 'active', 1, ${now}, ${now});
    INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at, version)
      VALUES ('${paymentId}', '${customerId}', 500, 'PHP', 'PENDING', 'mock', 'payment-${suffix}', ${now}, ${now}, 1);
    INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, version, created_at)
      VALUES ('${orderId}', '${customerId}', 'cycle-next-cebu', 'SCHEDULED', '{}', 'PENDING_PAYMENT', 500, 'PHP', '${paymentId}', 1, ${now});
  `);
  const data = { reason: "E2E cancellation", expectedVersion: 1 };
  const allowed = await adminPage.request.post(`/api/admin/orders/${orderId}/cancel`, {
    data,
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  const allowedBody = await allowed.json();
  expect(allowedBody, JSON.stringify(allowedBody)).toMatchObject({
    ok: true,
    value: { status: "CANCELED" },
  });
  const denied = await deniedAdminPage.request.post(`/api/admin/orders/${orderId}/cancel`, {
    data: { ...data, expectedVersion: 2 },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});
