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

test("a Global Administrator reviews Pricing & fees and recovers from a stale replacement", async ({
  adminPage,
}) => {
  await adminPage.route("**/api/admin/commerce-configuration/membership-price", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({
        expectedVersion: 7,
        amountMinor: 35_000,
        currency: "PHP",
        reason: "Approved annual review",
      });
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            code: "STALE_VERSION",
            message: "Membership price changed; refresh before retrying",
            requestId: "pricing-stale-e2e",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "pricing-read-e2e",
        value: {
          priceVersionId: "price-v7",
          offerId: "membership-global",
          amountMinor: 29_900,
          currency: "PHP",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          version: 7,
        },
      }),
    });
  });
  await adminPage.route("**/api/admin/commerce-configuration/service-fee", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "fee-read-e2e",
        value: {
          configurationId: "fee-v4",
          feeType: "MIXED",
          flatMinor: 1_500,
          percentageBasisPoints: 250,
          currency: "PHP",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          version: 4,
          reason: "Approved fee review",
        },
      }),
    }),
  );

  await adminPage.goto("/admin/commerce-configuration");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Pricing & fees" })).toBeVisible();
  await expect(adminPage.getByText("price-v7")).toBeVisible();
  await expect(
    adminPage.getByText(/Existing subscriptions retain their snapshotted price/),
  ).toBeVisible();
  await adminPage.getByLabel("Amount in minor units (PHP)").fill("35000");
  await adminPage.getByLabel("Replacement effective from").fill("2026-09-01T08:00");
  await adminPage.getByLabel("Reason for change").fill("Approved annual review");
  await adminPage.getByText(/I confirm this creates a new effective-dated version/).click();
  await adminPage.getByRole("button", { name: "Create replacement version" }).click();
  await expect(adminPage.getByRole("alert")).toContainText("Configuration changed");
  await expect(adminPage.getByRole("alert")).toContainText("pricing-stale-e2e");
  await adminPage.getByRole("button", { name: "Refresh current version" }).click();

  await adminPage.getByRole("link", { name: "Instant Service Fee" }).click();
  await expect(adminPage.getByText("fee-v4")).toBeVisible();
  await expect(adminPage.getByText(/Instant orders only/)).toBeVisible();
  await expect(adminPage.getByText("Replace Service Fee", { exact: true })).toBeVisible();
});

test("a provisioned Staff operator uses the real payment workspaces and contextual refund", async ({
  adminPage,
}) => {
  const suffix = crypto.randomUUID();
  const now = Date.now();
  const userId = `payment-user-${suffix}`;
  const principalId = `payment-principal-${suffix}`;
  const customerId = `payment-customer-${suffix}`;
  const paymentIntentId = `payment-intent-${suffix}`;
  const reconciliationCaseId = `reconciliation-${suffix}`;
  executeAdminE2eSql(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${userId}', 'Payment Customer', 'payment-${suffix}@example.com', 1, ${now}, ${now});
    INSERT INTO customer_principal (id, auth_user_id, status, created_at, updated_at)
      VALUES ('${principalId}', '${userId}', 'active', ${now}, ${now});
    INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at)
      VALUES ('${customerId}', '${userId}', '${principalId}', 'active', 1, ${now}, ${now});
    INSERT INTO payment_intent
      (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status,
       idempotency_key, version, created_at, updated_at)
      VALUES ('${paymentIntentId}', 'GROCERY_CHECKOUT', 'checkout_quote', 'quote-${suffix}',
              '${customerId}', 12500, 'PHP', 'SUCCEEDED', 'intent-${suffix}', 1, ${now}, ${now});
    INSERT INTO payment_reconciliation_case
      (id, payment_intent_id, category, status, details_json, created_at)
      VALUES ('${reconciliationCaseId}', '${paymentIntentId}', 'AMBIGUOUS_OUTCOME', 'OPEN', '{}', ${now});
  `);

  await adminPage.goto("/admin/payments");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(adminPage.getByText("Recent transactions")).toBeVisible();

  await adminPage.goto("/admin/payments/transactions");
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "Payment transactions" }),
  ).toBeVisible();
  await expect(adminPage.getByText(`payment-${suffix}@example.com`)).toBeVisible();

  await adminPage.goto(`/admin/payments/transactions/${paymentIntentId}`);
  await expect(
    adminPage.getByRole("heading", { level: 1, name: `Payment ${paymentIntentId}` }),
  ).toBeVisible();
  await adminPage.getByLabel("Refund amount").fill("25.00");
  await adminPage.getByRole("button", { name: "Request refund" }).click();
  await expect(adminPage.getByRole("alertdialog")).toContainText(paymentIntentId);
  await adminPage.getByLabel("Confirmation reason").fill("E2E quality issue");
  await adminPage.getByRole("button", { name: "Confirm" }).click();
  await expect(
    adminPage.getByRole("status").filter({ hasText: "Refund request recorded" }),
  ).toBeVisible();

  await adminPage.goto("/admin/payments/reconciliation");
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "Payment reconciliation" }),
  ).toBeVisible();
  await adminPage.getByRole("button", { name: "Review resolution" }).click();
  const reconciliationDialog = adminPage.getByRole("alertdialog");
  await expect(reconciliationDialog).toContainText(reconciliationCaseId);
  await expect(reconciliationDialog).toContainText(paymentIntentId);
  await reconciliationDialog.getByLabel("Confirmation reason").fill("Matched provider evidence");
  await reconciliationDialog.getByRole("button", { name: "Confirm resolution" }).click();
  await expect(adminPage.getByText("Reconciliation case resolved.")).toBeVisible();
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
