import { expect, test, executeAdminE2eSql } from "./admin-authenticated-fixture";

function seedProblem() {
  const id = crypto.randomUUID();
  const now = Date.now();
  const orderId = `problem-order-${id}`;
  const issueId = `problem-${id}`;
  const email = `synthetic-problem-${id}@example.invalid`;
  executeAdminE2eSql(`
    INSERT INTO user(id,name,email,email_verified,created_at,updated_at)
      VALUES ('user-${id}','Synthetic buyer','${email}',1,${now},${now});
    INSERT INTO customer(id,auth_user_id,status,created_at,updated_at)
      VALUES ('customer-${id}','user-${id}','active',${now},${now});
    INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
      VALUES ('payment-${id}','customer-${id}',100,'PHP','SUCCEEDED','mock','payment-${id}',${now},${now});
    INSERT INTO grocery_order(id,customer_id,payment_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at,committed_at,order_number)
      VALUES ('${orderId}','customer-${id}','payment-${id}','INSTANT','DELIVERED',100,'PHP','{"recipient":"Synthetic recipient","phone":"Phone withheld"}',${now},${now},'FM-PROBLEM-${id.slice(0, 8)}');
    INSERT INTO order_issue(id,order_id,customer_id,category,status,details,version,idempotency_key,created_at,updated_at)
      VALUES ('${issueId}','${orderId}','customer-${id}','MISSING_ITEM','SUBMITTED','One item was missing from the delivered order',1,'issue-${id}',${now},${now});
  `);
  return { issueId, orderId, email, orderNumber: `FM-PROBLEM-${id.slice(0, 8)}` };
}

test("a real paid-order Problem moves from New through handling to resolved without a refund", async ({
  adminPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problem = seedProblem();
  await page.goto("/admin/issues?status=SUBMITTED");
  await expect(page.getByRole("heading", { level: 1, name: "Problems" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const row = page.getByRole("row").filter({ hasText: problem.orderNumber });
  await expect(row).toContainText("Missing Item");
  await expect(row).toContainText("Unassigned");
  await page.screenshot({
    path: testInfo.outputPath("problems-new-1440.png"),
    mask: [page.locator("td p").filter({ hasText: /@example\./ }), page.locator('a[href^="tel:"]')],
    maskColor: "#CBD5E1",
  });
  await row.getByRole("link", { name: "Missing Item" }).click();
  await expect(
    page.locator("#main-content").getByRole("link", { name: "Problems" }),
  ).toHaveAttribute("href", /status=SUBMITTED/);
  await expect(page.getByRole("link", { name: problem.orderNumber })).toHaveAttribute(
    "href",
    `/admin/orders/${problem.orderId}`,
  );
  await page.getByRole("button", { name: "Start handling" }).click();
  await page.getByLabel("Confirmation reason").fill("Review the delivery report");
  await page.getByRole("alertdialog").getByRole("button", { name: "Start handling" }).click();
  await expect(page.getByText("Being handled", { exact: true })).toBeVisible();
  await expect(page.getByText("No resolution has been recorded.")).toBeVisible();
  await page.getByRole("button", { name: "Mark resolved" }).click();
  await page
    .getByLabel("Confirmation reason")
    .fill("Report handled; any refund needs separate approval");
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText("Report handled; any refund needs separate approval")).toBeVisible();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({
    path: testInfo.outputPath("problem-resolved-1440.png"),
    mask: [page.locator('a[href^="mailto:"]'), page.locator('a[href^="tel:"]')],
    maskColor: "#CBD5E1",
  });
  const order = await page.request.get(`/api/admin/orders/${problem.orderId}`);
  expect(await order.json()).toMatchObject({ ok: true, value: { status: "DELIVERED" } });
  const issue = await page.request.get(`/api/admin/order-issues/${problem.issueId}`);
  expect(await issue.json()).toMatchObject({
    ok: true,
    value: { status: "RESOLVED", resolution: "Report handled; any refund needs separate approval" },
  });
});

test("the Problems list retries one exact action after transport loss and processing", async ({
  adminPage: page,
}) => {
  const problem = seedProblem();
  const attempts: Array<{ key: string | undefined; body: string | null }> = [];
  await page.route(`**/api/admin/order-issues/${problem.issueId}/actions`, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (attempts.length === 1) return route.abort("failed");
    if (attempts.length === 2)
      return route.fulfill({
        json: {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Original report action still processing",
            requestId: "processing",
            details: { outcome: "RECONCILIATION_PENDING" },
          },
        },
      });
    return route.continue();
  });
  await page.goto("/admin/issues?status=SUBMITTED");
  const row = page.getByRole("row").filter({ hasText: problem.orderNumber });
  await row.getByRole("button", { name: "Open actions for Missing Item issue" }).click();
  await page.getByRole("menuitem", { name: "Start handling" }).click();
  await page.getByLabel("Confirmation reason").fill("Review delivery report");
  await page.getByRole("alertdialog").getByRole("button", { name: "Start handling" }).click();
  await expect(page.getByText("Problem action awaiting confirmation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry the same request" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Being handled" })).toBeDisabled();
  await page.getByRole("combobox", { name: "Active admin scope" }).click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Active admin scope" })).toContainText("Global");
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(
    page.getByRole("alert").getByText(/original problem action is still being checked/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(page.getByText("Start handling completed.")).toBeVisible();
  expect(attempts).toHaveLength(3);
  expect(
    attempts.every(
      (attempt) => attempt.key === attempts[0].key && attempt.body === attempts[0].body,
    ),
  ).toBe(true);
  expect(JSON.parse(attempts[0].body ?? "null")).toMatchObject({
    action: "CLAIM",
    reason: "Review delivery report",
    expectedVersion: 1,
  });
  const detail = await page.request.get(`/api/admin/order-issues/${problem.issueId}`);
  expect(await detail.json()).toMatchObject({ ok: true, value: { status: "CLAIMED" } });
});

test("an older Problems view response cannot replace the selected status", async ({
  adminPage: page,
}) => {
  await page.route("**/api/admin/order-issues?**", async (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    if (!status) await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      json: {
        ok: true,
        requestId: status ? "new-view" : "old-view",
        value: {
          items: status
            ? []
            : [
                {
                  issueId: "old-result",
                  orderId: "old-order",
                  orderNumber: "FM-OLD-RESULT",
                  category: "OTHER",
                  details: "Older response",
                  status: "RESOLVED",
                  assignedStaffName: null,
                  assignedStaffId: null,
                  customerName: "Synthetic buyer",
                  customerEmail: "withheld@example.invalid",
                  customerPhone: null,
                  resolution: null,
                  allowedActions: [],
                  version: 1,
                  createdAt: "2026-09-24T00:00:00.000Z",
                },
              ],
          nextCursor: null,
        },
      },
    });
  });
  await page.goto("/admin/issues");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("No order issues are visible in this view.")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByText("FM-OLD-RESULT")).toHaveCount(0);
});

test("a real Global orders reader sees the Problem without handling controls", async ({
  adminPage: page,
}) => {
  const problem = seedProblem();
  const contextResponse = await page.request.get("/api/admin/context");
  const context = (await contextResponse.json()) as { ok: boolean; value?: { staffId: string } };
  if (!context.ok || !context.value?.staffId) throw new Error("Missing synthetic staff context");
  executeAdminE2eSql(`
    DELETE FROM role_permission
    WHERE role_id IN (SELECT role_id FROM staff_role WHERE staff_id='${context.value.staffId}')
      AND permission_id=(SELECT id FROM permission WHERE code='orders.manage');
  `);
  await page.goto("/admin/issues?status=SUBMITTED");
  const row = page.getByRole("row").filter({ hasText: problem.orderNumber });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Open actions for Missing Item issue" }).click();
  await expect(page.getByRole("menuitem", { name: "Start handling" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await row.getByRole("link", { name: "Missing Item" }).click();
  await expect(page.getByRole("button", { name: "Start handling" })).toHaveCount(0);
  const denied = await page.request.post(`/api/admin/order-issues/${problem.issueId}/actions`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { action: "CLAIM", reason: "Should be denied", expectedVersion: 1 },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});

test("Problem detail freezes the exact note and key through an unknown processing response", async ({
  adminPage: page,
}) => {
  const problem = seedProblem();
  const attempts: Array<{ key: string | undefined; body: string | null }> = [];
  await page.route(`**/api/admin/order-issues/${problem.issueId}/actions`, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (attempts.length === 1) return route.abort("failed");
    if (attempts.length === 2)
      return route.fulfill({
        json: {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Original action is processing",
            requestId: "processing",
            details: { outcome: "RECONCILIATION_PENDING" },
          },
        },
      });
    return route.continue();
  });
  await page.goto(`/admin/issues/${problem.issueId}`);
  await page.getByRole("button", { name: "Start handling" }).click();
  await page.getByLabel("Confirmation reason").fill("Call the customer about the report");
  await page.getByRole("alertdialog").getByRole("button", { name: "Start handling" }).click();
  await expect(page.getByText("Support action awaiting confirmation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry the same request" })).toBeFocused();
  await page.locator("#main-content").getByRole("link", { name: "Problems" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/issues/${problem.issueId}$`));
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(
    page.getByRole("alert").getByText(/original support action is still being checked/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(page.getByRole("button", { name: "Mark resolved" })).toBeVisible();
  expect(attempts).toHaveLength(3);
  expect(
    attempts.every(
      (attempt) => attempt.key === attempts[0].key && attempt.body === attempts[0].body,
    ),
  ).toBe(true);
  expect(JSON.parse(attempts[0].body ?? "null")).toMatchObject({
    action: "CLAIM",
    reason: "Call the customer about the report",
    expectedVersion: 1,
  });
});

test("a stale Problem action reloads current Core state without a replacement POST", async ({
  adminPage: page,
}) => {
  const problem = seedProblem();
  let posts = 0;
  await page.route(`**/api/admin/order-issues/${problem.issueId}/actions`, async (route) => {
    posts += 1;
    executeAdminE2eSql(
      `UPDATE order_issue SET status='CLAIMED',version=2 WHERE id='${problem.issueId}';`,
    );
    await route.fulfill({
      json: {
        ok: false,
        error: {
          code: "STALE_VERSION",
          message: "Problem changed; refresh before retrying",
          requestId: "stale-problem",
        },
      },
    });
  });
  await page.goto(`/admin/issues/${problem.issueId}`);
  await page.getByRole("button", { name: "Start handling" }).click();
  await page.getByLabel("Confirmation reason").fill("Review delivery report");
  await page.getByRole("alertdialog").getByRole("button", { name: "Start handling" }).click();
  await expect(page.getByRole("button", { name: "Mark resolved" })).toBeVisible();
  await expect(page.getByText("Problem changed; refresh before retrying")).toBeVisible();
  expect(posts).toBe(1);
});

test("a confirmed Problem action stays visible when its follow-up read fails", async ({
  adminPage: page,
}) => {
  const problem = seedProblem();
  let reads = 0;
  await page.route(`**/api/admin/order-issues/${problem.issueId}`, async (route) => {
    reads += 1;
    if (reads === 2) return route.abort("failed");
    return route.continue();
  });
  await page.goto(`/admin/issues/${problem.issueId}`);
  await page.getByRole("button", { name: "Start handling" }).click();
  await page.getByLabel("Confirmation reason").fill("Review the delivery report");
  await page.getByRole("alertdialog").getByRole("button", { name: "Start handling" }).click();
  await expect(page.getByRole("button", { name: "Mark resolved" })).toBeVisible();
  await expect(page.getByText("Being handled", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E admin", { exact: true })).toBeVisible();
  await expect(page.getByText("Start handling completed.")).toBeVisible();
  await expect(page.getByText("Action confirmed; latest record unavailable")).toBeVisible();
  await expect(page.getByText("No resolution has been recorded.")).toBeVisible();
  await page.getByRole("button", { name: "Refresh problem record" }).click();
  await expect(page.getByText("Action confirmed; latest record unavailable")).toHaveCount(0);
  expect(reads).toBe(3);
});

test("a definite Problem conflict releases recovery after a current-state read", async ({
  adminPage: page,
}) => {
  const problem = seedProblem();
  let posts = 0;
  await page.route(`**/api/admin/order-issues/${problem.issueId}/actions`, async (route) => {
    posts += 1;
    await route.fulfill({
      json: {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "The saved problem action needs review",
          requestId: "definite-conflict",
        },
      },
    });
  });
  await page.goto(`/admin/issues/${problem.issueId}`);
  await page.getByRole("button", { name: "Start handling" }).click();
  await page.getByLabel("Confirmation reason").fill("Review the report");
  await page.getByRole("alertdialog").getByRole("button", { name: "Start handling" }).click();
  await expect(page.getByText("The saved problem action needs review")).toBeVisible();
  await expect(page.getByText("Support action awaiting confirmation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry the same request" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start handling" })).toBeEnabled();
  expect(posts).toBe(1);
});
