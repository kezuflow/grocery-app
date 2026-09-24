import { executeAdminE2eSql, expect, test } from "./admin-authenticated-fixture";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Finance workspace smoke coverage with deterministic local Staff identities.
 */
test.describe.configure({ timeout: 180000 });
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

test("Membership history preserves its query and safely recovers an unconfirmed cancellation", async ({
  adminPage,
}) => {
  const suffix = crypto.randomUUID();
  const now = Date.now();
  const userId = `membership-user-${suffix}`;
  const principalId = `membership-principal-${suffix}`;
  const customerId = `membership-customer-${suffix}`;
  const subscriptionId = `membership-${suffix}`;
  const email = `membership-${suffix}@example.com`;
  const searchToken = `membership-${suffix.slice(0, 8)}`;
  executeAdminE2eSql(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${userId}', 'Membership Customer', '${email}', 1, ${now}, ${now});
    INSERT INTO customer_principal (id, auth_user_id, status, created_at, updated_at)
      VALUES ('${principalId}', '${userId}', 'active', ${now}, ${now});
    INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at)
      VALUES ('${customerId}', '${userId}', '${principalId}', 'active', 1, ${now}, ${now});
    INSERT INTO subscription
      (id, customer_id, offer_id, status, starts_at, current_period_ends_at, created_at, updated_at, version)
      VALUES ('${subscriptionId}', '${customerId}', 'offer-membership-monthly', 'ACTIVE', ${now}, ${now + 2_592_000_000}, ${now}, ${now}, 1);
  `);

  const attempts: Array<{ body: string | null; key: string | null }> = [];
  await adminPage.route(`**/api/admin/memberships/${subscriptionId}/cancel`, async (route) => {
    attempts.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"] ?? null,
    });
    if (attempts.length === 1) {
      const accepted = await route.fetch();
      expect(await accepted.json()).toMatchObject({ ok: true, value: { state: "CANCELED" } });
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await adminPage.goto(`/admin/memberships?query=${encodeURIComponent(searchToken)}`);
  await expect(adminPage.getByRole("textbox", { name: "Search membership history" })).toHaveValue(
    searchToken,
  );
  if (process.env.SAUI_CAPTURE_MEMBERSHIPS === "1") {
    await adminPage.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-05/membership-list-1440.png",
      fullPage: true,
    });
  }
  await adminPage.getByRole("link", { name: email }).click();
  await expect(adminPage.getByRole("heading", { level: 1, name: email })).toBeVisible();
  if (process.env.SAUI_CAPTURE_MEMBERSHIPS === "1") {
    await adminPage.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-05/membership-record-1440.png",
      fullPage: true,
    });
  }
  let failedReadback = 0;
  await adminPage.route(`**/api/admin/memberships/${subscriptionId}`, (route) => {
    failedReadback += 1;
    return route.abort("failed");
  });
  await adminPage.getByRole("textbox", { name: "Cancellation reason" }).fill("Customer request");
  await adminPage.getByRole("button", { name: "Cancel membership" }).click();
  const confirmation = adminPage.getByRole("alertdialog");
  await expect(confirmation).toContainText(
    "does not confirm cancellation of provider-owned billing",
  );
  await confirmation.getByRole("button", { name: "Cancel membership" }).click();
  await expect(
    adminPage.getByRole("button", { name: "Retry unconfirmed cancellation" }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("button", { name: "Retry unconfirmed cancellation" }),
  ).toBeFocused();
  await expect(adminPage.getByRole("textbox", { name: "Cancellation reason" })).toBeDisabled();
  await adminPage.getByRole("button", { name: "Retry unconfirmed cancellation" }).click();
  await expect(adminPage.getByText("Canceled", { exact: true }).first()).toBeVisible();
  await expect(
    adminPage.getByText(/cancellation is confirmed, but the latest record/i),
  ).toBeVisible();
  expect(failedReadback).toBe(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);

  await adminPage.getByRole("main").getByRole("link", { name: "Membership history" }).click();
  await expect(adminPage.getByRole("textbox", { name: "Search membership history" })).toHaveValue(
    searchToken,
  );
  const current = await adminPage.request.get(`/api/admin/memberships/${subscriptionId}`);
  expect(await current.json()).toMatchObject({ ok: true, value: { state: "CANCELED" } });
});

test("a memberships.read-only principal cannot cancel a retained record", async ({
  membershipsReadOnlyPage,
}) => {
  const suffix = crypto.randomUUID();
  const now = Date.now();
  const userId = `membership-reader-user-${suffix}`;
  const principalId = `membership-reader-principal-${suffix}`;
  const customerId = `membership-reader-customer-${suffix}`;
  const subscriptionId = `membership-reader-${suffix}`;
  const email = `membership-reader-${suffix}@example.com`;
  executeAdminE2eSql(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${userId}', 'Membership Reader Customer', '${email}', 1, ${now}, ${now});
    INSERT INTO customer_principal (id, auth_user_id, status, created_at, updated_at)
      VALUES ('${principalId}', '${userId}', 'active', ${now}, ${now});
    INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at)
      VALUES ('${customerId}', '${userId}', '${principalId}', 'active', 1, ${now}, ${now});
    INSERT INTO subscription
      (id, customer_id, offer_id, status, starts_at, created_at, updated_at, version)
      VALUES ('${subscriptionId}', '${customerId}', 'offer-membership-monthly', 'ACTIVE', ${now}, ${now}, ${now}, 1);
  `);
  await membershipsReadOnlyPage.goto(`/admin/memberships/${subscriptionId}`);
  await expect(membershipsReadOnlyPage.getByRole("heading", { level: 1, name: email })).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(
    membershipsReadOnlyPage.getByText(/cancellation requires memberships\.manage/i),
  ).toBeVisible();
  await expect(
    membershipsReadOnlyPage.getByRole("textbox", { name: "Cancellation reason" }),
  ).toHaveCount(0);
  await expect(
    membershipsReadOnlyPage.getByRole("button", { name: "Cancel membership" }),
  ).toHaveCount(0);
  const denied = await membershipsReadOnlyPage.request.post(
    `/api/admin/memberships/${subscriptionId}/cancel`,
    {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { reason: "Must be denied", timing: "IMMEDIATE", expectedVersion: 1 },
    },
  );
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});

test("Membership detail keeps missing, denied, and load failures distinct", async ({
  adminPage,
}) => {
  const missingId = `membership-missing-${crypto.randomUUID()}`;
  const deniedId = `membership-denied-${crypto.randomUUID()}`;
  const failedId = `membership-failed-${crypto.randomUUID()}`;
  await adminPage.route(`**/api/admin/memberships/${missingId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: "Membership not found", requestId: "missing" },
      }),
    }),
  );
  await adminPage.goto(`/admin/memberships/${missingId}`);
  await expect(adminPage.getByText("Membership not found", { exact: true })).toBeVisible();

  await adminPage.route(`**/api/admin/memberships/${deniedId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "FORBIDDEN", message: "Membership access denied", requestId: "denied" },
      }),
    }),
  );
  await adminPage.goto(`/admin/memberships/${deniedId}`);
  await expect(adminPage.getByText("Membership access denied", { exact: true })).toBeVisible();

  await adminPage.route(`**/api/admin/memberships/${failedId}`, (route) => route.abort("failed"));
  await adminPage.goto(`/admin/memberships/${failedId}`);
  await expect(adminPage.getByText("Membership record unavailable", { exact: true })).toBeVisible();
  await expect(adminPage.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("a provisioned Staff reader opens the real Orders workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/orders");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
});

test("shared index views preserve the Problems status filter", async ({ adminPage }) => {
  const statuses: string[] = [];
  await adminPage.route("**/api/admin/order-issues?**", (route) => {
    statuses.push(new URL(route.request().url()).searchParams.get("status") ?? "");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "problem-view-test",
        value: { items: [], nextCursor: null },
      }),
    });
  });
  await adminPage.goto("/admin/issues");
  await adminPage.getByRole("button", { name: "Being handled" }).click();
  await expect(adminPage.getByRole("button", { name: "Being handled" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => statuses.includes("CLAIMED")).toBe(true);
});

test("Orders shows loading, retryable error, and a truthful empty result", async ({
  adminPage,
}) => {
  let attempts = 0;
  await adminPage.route("**/api/admin/orders?**", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { code: "UNAVAILABLE", message: "Local read unavailable", requestId: "test-read" },
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "test-empty",
        value: { items: [], nextCursor: null },
      }),
    });
  });
  await adminPage.goto("/admin/orders");
  await expect(adminPage.getByRole("status").filter({ hasText: "Loading orders" })).toBeVisible();
  await expect(adminPage.getByRole("alert")).toContainText("Local read unavailable");
  await adminPage.getByRole("button", { name: "Retry" }).click();
  await expect(
    adminPage.getByRole("status").filter({ hasText: "No orders are visible" }),
  ).toBeVisible();
});

test("Orders rejects a late response from the previous scope", async ({ adminPage }) => {
  let requestCount = 0;
  await adminPage.route("**/api/admin/orders?**", async (route) => {
    requestCount += 1;
    const old = requestCount === 1;
    if (old) await new Promise((resolve) => setTimeout(resolve, 700));
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "scope-read-test",
        value: {
          items: [
            {
              orderId: old ? "old-scope-order" : "new-scope-order",
              orderNumber: old ? "FM-OLD-SCOPE" : "FM-NEW-SCOPE",
              customerName: "Fixture Customer",
              customerEmail: "fixture@example.test",
              fulfillmentMode: "INSTANT",
              status: "COMMITTED",
              totalMinor: 10000,
              currency: "PHP",
              paymentStatus: "SUCCEEDED",
              fulfillmentStatus: "NOT_STARTED",
              deliveryStatus: null,
              deliveryDispatchStatus: null,
              deliveryProviderStatus: null,
              committedAt: "2026-09-21T08:00:00.000Z",
              version: 1,
            },
          ],
          nextCursor: null,
        },
      }),
    });
  });
  await adminPage.goto("/admin/orders");
  const selector = adminPage.getByRole("combobox", { name: "Active admin scope" });
  await selector.click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(selector).toContainText("Central Cebu");
  await expect(adminPage.getByRole("link", { name: "FM-NEW-SCOPE" })).toBeVisible();
  await expect(adminPage.getByRole("link", { name: "FM-OLD-SCOPE" })).toHaveCount(0);
  expect(requestCount).toBeGreaterThanOrEqual(2);
});

test("Orders Back restores the list scroll position within the same scope", async ({
  adminPage,
}) => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    orderId: `scroll-order-${index}`,
    orderNumber: `FM-SCROLL-${index}`,
    customerName: "Fixture Customer",
    customerEmail: "fixture@example.test",
    fulfillmentMode: "INSTANT",
    status: "COMMITTED",
    totalMinor: 10000,
    currency: "PHP",
    paymentStatus: "SUCCEEDED",
    fulfillmentStatus: "NOT_STARTED",
    deliveryStatus: null,
    deliveryDispatchStatus: null,
    deliveryProviderStatus: null,
    committedAt: "2026-09-21T08:00:00.000Z",
    version: 1,
  }));
  await adminPage.route("**/api/admin/orders?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "scroll-test",
        value: { items, nextCursor: null },
      }),
    }),
  );
  await adminPage.route("**/api/admin/orders/scroll-order-39", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Fixture detail" } }),
    }),
  );
  await adminPage.goto("/admin/orders");
  const last = adminPage.getByRole("link", { name: "FM-SCROLL-39" });
  await last.scrollIntoViewIfNeeded();
  const before = await adminPage.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(100);
  await last.click();
  await adminPage.getByRole("link", { name: "Orders", exact: true }).last().click();
  await expect(last).toBeVisible();
  await expect
    .poll(async () => Math.abs((await adminPage.evaluate(() => window.scrollY)) - before))
    .toBeLessThan(50);
});

test("Order number opens the record and Back restores the filtered cursor page", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  const requests: string[] = [];
  await adminPage.route("**/api/admin/orders?**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const second = url.searchParams.get("cursor") === "next-orders";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "orders-return-test",
        value: {
          items: [
            {
              orderId: second ? "test-order-2" : "test-order-1",
              orderNumber: second ? "FM-RETURN-2" : "FM-RETURN-1",
              customerName: "Fixture Customer",
              customerEmail: "fixture@example.test",
              fulfillmentMode: "INSTANT",
              status: "COMMITTED",
              totalMinor: 10000,
              currency: "PHP",
              paymentStatus: "SUCCEEDED",
              fulfillmentStatus: "NOT_STARTED",
              deliveryStatus: null,
              deliveryDispatchStatus: null,
              deliveryProviderStatus: null,
              committedAt: "2026-09-21T08:00:00.000Z",
              version: 1,
            },
          ],
          nextCursor: second ? null : "next-orders",
        },
      }),
    });
  });
  await adminPage.route("**/api/admin/orders/test-order-2", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "orders-record-test",
        value: {
          orderId: "test-order-2",
          orderNumber: "FM-RETURN-2",
          customerName: "Fixture Customer",
          customerEmail: "fixture@example.test",
          fulfillmentMode: "INSTANT",
          status: "COMMITTED",
          totalMinor: 10000,
          currency: "PHP",
          paymentStatus: "SUCCEEDED",
          fulfillmentStatus: "NOT_STARTED",
          deliveryStatus: null,
          deliveryDispatchStatus: null,
          deliveryProviderStatus: null,
          committedAt: "2026-09-21T08:00:00.000Z",
          version: 1,
          allowedActions: ["CANCEL"],
          customer: {
            name: "Fixture Customer",
            email: "fixture@example.test",
            phone: null,
            addressLines: ["Cebu City"],
          },
          financial: {
            subtotalMinor: 10000,
            discountMinor: 0,
            deliveryFeeMinor: 0,
            serviceFeeMinor: 0,
            taxMinor: 0,
            totalMinor: 10000,
            currency: "PHP",
            source: "CHECKOUT_QUOTE",
          },
          items: [
            {
              productName: "Fresh Carrots",
              variantName: "1 kg",
              unit: "GRAM",
              quantity: 1,
              baseQuantity: 1000,
              unitPriceMinor: 10000,
              lineTotalMinor: 10000,
            },
          ],
          payments: [],
          amendments: [],
          fulfillment: null,
          delivery: null,
          exceptions: [],
          timeline: [],
          recentAudit: [],
        },
      }),
    }),
  );
  await adminPage.goto("/admin/orders");
  await expect(adminPage.getByRole("link", { name: "FM-RETURN-1" })).toBeVisible();
  if (process.env.SAUI_CAPTURE_ORDERS === "1") {
    const path = fileURLToPath(
      new URL(
        "../../../docs/operations/checkpoints/evidence/saui-03/orders-index-desktop.png",
        import.meta.url,
      ),
    );
    mkdirSync(dirname(path), { recursive: true });
    await adminPage.screenshot({ path, fullPage: true });
  }
  await adminPage.getByRole("button", { name: "Committed", exact: true }).click();
  await expect(adminPage).toHaveURL(/\/admin\/orders\?status=COMMITTED$/);
  await adminPage
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(adminPage).toHaveURL(/status=COMMITTED.*cursor=next-orders/);
  await adminPage.getByRole("link", { name: "FM-RETURN-2" }).click();
  await expect(adminPage).toHaveURL(/\/admin\/orders\/test-order-2\?/);
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "Order FM-RETURN-2" }),
  ).toBeVisible();
  if (process.env.SAUI_CAPTURE_ORDERS === "1") {
    const path = fileURLToPath(
      new URL(
        "../../../docs/operations/checkpoints/evidence/saui-03/order-record-desktop.png",
        import.meta.url,
      ),
    );
    await adminPage.screenshot({ path, fullPage: true });
  }
  await adminPage.getByRole("button", { name: "Cancel order" }).click();
  await expect(adminPage.getByRole("alertdialog")).toContainText("Confirm order cancellation");
  if (process.env.SAUI_CAPTURE_ORDERS === "1") {
    const path = fileURLToPath(
      new URL(
        "../../../docs/operations/checkpoints/evidence/saui-03/order-confirmation-desktop.png",
        import.meta.url,
      ),
    );
    await adminPage.screenshot({ path, fullPage: true });
  }
  await adminPage.getByRole("button", { name: "Keep unchanged" }).click();
  await expect(adminPage.getByRole("alertdialog")).toHaveCount(0);
  await expect(adminPage.getByRole("button", { name: "Cancel order" })).toBeFocused();
  await adminPage.setViewportSize({ width: 390, height: 844 });
  expect(
    await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  if (process.env.SAUI_CAPTURE_ORDERS === "1") {
    const path = fileURLToPath(
      new URL(
        "../../../docs/operations/checkpoints/evidence/saui-03/order-record-mobile.png",
        import.meta.url,
      ),
    );
    await adminPage.screenshot({ path, fullPage: true });
  }
  await adminPage.getByRole("link", { name: "Orders", exact: true }).last().click();
  await expect(adminPage).toHaveURL(/status=COMMITTED.*cursor=next-orders/);
  await expect(adminPage.getByRole("link", { name: "FM-RETURN-2" })).toBeVisible();
  await adminPage.setViewportSize({ width: 390, height: 844 });
  expect(
    await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(adminPage.getByRole("button", { name: "Preview order" })).toBeVisible();
  if (process.env.SAUI_CAPTURE_ORDERS === "1") {
    const path = fileURLToPath(
      new URL(
        "../../../docs/operations/checkpoints/evidence/saui-03/orders-index-mobile.png",
        import.meta.url,
      ),
    );
    await adminPage.screenshot({ path, fullPage: true });
  }
  expect(
    requests.some(
      (query) => query.includes("status=COMMITTED") && query.includes("cursor=next-orders"),
    ),
  ).toBe(true);
});

test("the Order list shows complete operational progress without an Unassigned status", async ({
  adminPage,
}) => {
  const items = [
    {
      orderId: "order-committed",
      orderNumber: "FM-PROGRESS-1",
      customerName: "Committed Customer",
      customerEmail: "committed@example.test",
      fulfillmentMode: "INSTANT",
      status: "COMMITTED",
      totalMinor: 10_000,
      currency: "PHP",
      paymentStatus: "SUCCEEDED",
      fulfillmentStatus: "NOT_STARTED",
      deliveryStatus: "UNASSIGNED",
      deliveryDispatchStatus: null,
      deliveryProviderStatus: null,
      committedAt: "2026-09-21T08:00:00.000Z",
      version: 1,
    },
    {
      orderId: "order-packing",
      orderNumber: "FM-PROGRESS-2",
      customerName: "Packing Customer",
      customerEmail: "packing@example.test",
      fulfillmentMode: "INSTANT",
      status: "FULFILLMENT_PENDING",
      totalMinor: 12_000,
      currency: "PHP",
      paymentStatus: "SUCCEEDED",
      fulfillmentStatus: "PACKING",
      deliveryStatus: "UNASSIGNED",
      deliveryDispatchStatus: "ACTIVE",
      deliveryProviderStatus: "ALLOCATING",
      committedAt: "2026-09-21T08:05:00.000Z",
      version: 2,
    },
    {
      orderId: "order-canceled",
      orderNumber: "FM-PROGRESS-3",
      customerName: "Canceled Customer",
      customerEmail: "canceled@example.test",
      fulfillmentMode: "SCHEDULED",
      status: "CANCELED",
      totalMinor: 9_000,
      currency: "PHP",
      paymentStatus: "REFUNDED",
      fulfillmentStatus: "PACKING",
      deliveryStatus: "UNASSIGNED",
      deliveryDispatchStatus: "ACTIVE",
      deliveryProviderStatus: "ALLOCATING",
      committedAt: "2026-09-21T08:10:00.000Z",
      version: 3,
    },
  ];
  await adminPage.route("**/api/admin/orders?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "order-progress-list",
        value: { items, nextCursor: null },
      }),
    }),
  );

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await adminPage.setViewportSize(viewport);
    await adminPage.goto("/admin/orders");

    await expect(adminPage.getByLabel("Order progress: Committed").first()).toBeAttached();
    await expect(
      adminPage.getByLabel("Order progress: Packing; Finding rider").first(),
    ).toBeAttached();
    await expect(adminPage.getByLabel("Order progress: Canceled").first()).toBeAttached();
    await expect(adminPage.getByLabel(/Order progress: Unassigned/)).toHaveCount(0);
    expect(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("clicking an Order row opens the authoritative item preview and status selector", async ({
  adminPage,
}) => {
  let currentStatus = "COMMITTED";
  const summary = {
    orderId: "order-preview-1",
    orderNumber: "FM-PREVIEW-1",
    customerName: "Preview Customer",
    customerEmail: "preview@example.test",
    fulfillmentMode: "INSTANT",
    status: "COMMITTED",
    totalMinor: 12_500,
    currency: "PHP",
    paymentStatus: "SUCCEEDED",
    fulfillmentStatus: "NOT_STARTED",
    deliveryStatus: null,
    deliveryDispatchStatus: null,
    deliveryProviderStatus: null,
    committedAt: "2026-09-21T08:00:00.000Z",
    version: 2,
  };
  await adminPage.route("**/api/admin/orders?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "preview-list",
        value: { items: [summary], nextCursor: null },
      }),
    }),
  );
  await adminPage.route("**/api/admin/orders/order-preview-1", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "preview-detail",
        value: {
          ...summary,
          status: currentStatus,
          allowedActions: currentStatus === "COMMITTED" ? ["CANCEL"] : [],
          customer: {
            name: summary.customerName,
            email: summary.customerEmail,
            phone: null,
            addressLines: ["Cebu City"],
          },
          financial: {
            subtotalMinor: 12_500,
            discountMinor: 0,
            deliveryFeeMinor: 0,
            serviceFeeMinor: 0,
            taxMinor: 0,
            totalMinor: 12_500,
            currency: "PHP",
            source: "CHECKOUT_QUOTE",
          },
          items: [
            {
              productName: "Fresh Carrots",
              variantName: "1 kg",
              unit: "GRAM",
              quantity: 1,
              baseQuantity: 1_000,
              unitPriceMinor: 12_500,
              lineTotalMinor: 12_500,
            },
          ],
          payments: [],
          amendments: [],
          fulfillment: null,
          delivery: null,
          exceptions: [],
          timeline: [],
          recentAudit: [],
        },
      }),
    }),
  );
  await adminPage.route("**/api/admin/orders/order-preview-1/cancel", async (route) => {
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({
      reasonCode: "Customer requested cancellation",
      expectedVersion: 2,
    });
    currentStatus = "CANCELED";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "preview-cancel",
        value: { orderId: summary.orderId, state: "CANCELED", cancellation: null },
      }),
    });
  });

  await adminPage.goto("/admin/orders");
  await adminPage.getByRole("table", { name: "Order list" }).getByText("Preview Customer").click();

  await expect(adminPage.getByText("Order Preview", { exact: true })).toBeVisible();
  await expect(
    adminPage.getByRole("table", { name: "Ordered items for FM-PREVIEW-1" }),
  ).toContainText("Fresh Carrots");
  await expect(adminPage.getByRole("combobox", { name: "Order status" })).toBeVisible();

  await adminPage.getByRole("combobox", { name: "Order status" }).click();
  await adminPage.getByRole("option", { name: "Canceled" }).click();
  await expect(adminPage.getByRole("alertdialog")).toContainText("Confirm order cancellation");
  await adminPage.getByLabel("Confirmation reason").fill("Customer requested cancellation");
  await adminPage.getByRole("button", { name: "Confirm" }).click();
  await expect(adminPage.getByRole("combobox", { name: "Order status" })).toContainText("Canceled");
});

test("retired membership pricing leads to current settings and rejects writes", async ({
  adminPage,
}) => {
  await adminPage.goto("/admin/commerce-configuration");
  await expect(adminPage).toHaveURL("/admin/settings/fulfillment-mode");
  await expect(
    adminPage.getByRole("heading", { name: "Membership pricing", exact: true }),
  ).toHaveCount(0);
  const response = await adminPage.request.post(
    "/api/admin/commerce-configuration/membership-price",
    {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        expectedVersion: 1,
        amountMinor: 35000,
        currency: "PHP",
        effectiveFrom: new Date().toISOString(),
        reason: "Retirement rejection check",
      },
    },
  );
  expect(await response.json()).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
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
    INSERT INTO payment_attempt (id, customer_id, payment_intent_id, provider_reference, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at)
      VALUES ('attempt-${suffix}', '${customerId}', '${paymentIntentId}', 'mock-captured-${suffix}', 12500, 'PHP', 'SUCCEEDED', 'mock', 'attempt-key-${suffix}', ${now}, ${now});
    INSERT INTO payment_reconciliation_case
      (id, payment_intent_id, category, status, details_json, created_at)
      VALUES ('${reconciliationCaseId}', '${paymentIntentId}', 'AMBIGUOUS_OUTCOME', 'OPEN', '{}', ${now});
  `);

  await adminPage.goto("/admin/payments");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(adminPage.getByRole("table", { name: "Payments" })).toBeVisible();

  await adminPage.goto("/admin/payments/transactions");
  await expect(adminPage).toHaveURL(/\/admin\/payments$/u);
  await expect(adminPage.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(adminPage.getByText(`payment-${suffix}@example.com`)).toBeVisible();

  await adminPage.goto(`/admin/payments/transactions/${paymentIntentId}`);
  await expect(adminPage).toHaveURL(new RegExp(`/admin/payments\\?payment=${paymentIntentId}`));
  await expect(adminPage.getByRole("heading", { level: 2, name: paymentIntentId })).toBeVisible();
  await adminPage.getByLabel("Refund amount").fill("25.00");
  await adminPage.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(adminPage.getByRole("alertdialog")).toContainText(paymentIntentId);
  await adminPage.getByLabel("Confirmation reason").fill("E2E quality issue");
  await adminPage.getByRole("button", { name: "Confirm" }).click();
  await expect(
    adminPage.getByRole("status").filter({ hasText: "Refund request accepted" }),
  ).toBeVisible();

  await adminPage.goto("/admin/payments/reconciliation");
  await expect(adminPage).toHaveURL(/\/admin\/payments\?tab=attention/u);
  const attention = (await (
    await adminPage.request.get("/api/admin/payments/attention?limit=50")
  ).json()) as {
    ok: boolean;
    value: { items: { groupKey: string; paymentIntentId: string | null }[] };
  };
  expect(attention.ok).toBe(true);
  const issue = attention.value.items.find((item) => item.paymentIntentId === paymentIntentId);
  expect(issue).toBeDefined();
  await adminPage.goto(
    `/admin/payments?tab=attention&issue=${encodeURIComponent(issue!.groupKey)}`,
  );
  // This synthetic paid fixture has no applied checkout commitment. A note
  // cannot make that unresolved money safe; the actual recovery must finish.
  await expect(adminPage.getByRole("heading", { name: "Payment issue" })).toBeVisible();
  await expect(
    adminPage.getByText("No safe staff action is currently available.", { exact: false }),
  ).toBeVisible();
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
  await adminPage.goto("/admin/orders");
  await adminPage.getByRole("link", { name: orderId }).click();
  await expect(
    adminPage.getByRole("heading", { level: 1, name: `Order ${orderId}` }),
  ).toBeVisible();
  await adminPage.getByRole("button", { name: "Cancel order" }).click();
  await adminPage.getByLabel("Confirmation reason").fill("E2E cancellation");
  await adminPage.getByRole("button", { name: "Confirm" }).click();
  await expect(adminPage.getByRole("status").filter({ hasText: "Order canceled" })).toBeVisible();
  await expect(adminPage.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
  await expect(adminPage.getByText("Canceled", { exact: true }).first()).toBeVisible();
  const updated = await adminPage.request.get(`/api/admin/orders/${orderId}`);
  expect(await updated.json()).toMatchObject({ ok: true, value: { status: "CANCELED" } });
  await adminPage.getByRole("link", { name: "Orders", exact: true }).last().click();
  await expect(adminPage.getByRole("link", { name: orderId })).toBeVisible();
  const denied = await deniedAdminPage.request.post(`/api/admin/orders/${orderId}/cancel`, {
    data: { reason: "E2E denied cancellation", expectedVersion: 2 },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});
