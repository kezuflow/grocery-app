import { expect, test } from "./admin-authenticated-fixture";

const createdAt = "2026-09-25T02:00:00.000Z";

function payment(id: string, name: string) {
  return {
    paymentIntentId: id,
    purpose: "GROCERY_CHECKOUT",
    customerName: `${name} Customer`,
    customerEmail: "Deleted customer",
    orderId: null,
    orderNumber: `${name} order`,
    amountMinor: 4200,
    currency: "PHP",
    status: "SUCCEEDED",
    refundedMinor: 0,
    createdAt,
  };
}

function detail(id: string, name: string) {
  return {
    ...payment(id, name),
    subjectType: "checkout_quote",
    subjectId: `quote-${id}`,
    canonicalStatus: "SUCCEEDED",
    displayStatus: "PAID",
    remainingRefundableMinor: 4200,
    refundUnavailableReason: null,
    lookupRecovery: {
      version: 1,
      status: "NOT_STARTED",
      attempts: 0,
      nextCheckAt: null,
      lastErrorCode: null,
      canRecheck: false,
    },
    version: 2,
    updatedAt: createdAt,
    allowedActions: ["REQUEST_REFUND"],
    attempts: [],
    refunds: [],
    events: [],
    reactions: [],
    reconciliationCases: [],
    recentAudit: [],
  };
}

test("Finance restores URL cursor and detail independently, without carrying a refund draft", async ({
  adminPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/admin/payments?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          items: cursor
            ? [payment("finance-beta", "Beta")]
            : [payment("finance-alpha", "Alpha"), payment("finance-beta", "Beta")],
          nextCursor: cursor ? null : "finance-page-two",
        },
      }),
    });
  });
  let alphaReads = 0;
  let releaseAlpha!: () => void;
  const heldAlpha = new Promise<void>((resolve) => (releaseAlpha = resolve));
  await page.route("**/api/admin/payments/finance-alpha", async (route) => {
    alphaReads += 1;
    if (alphaReads === 2) await heldAlpha;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: detail("finance-alpha", "Alpha") }),
    });
  });
  await page.route("**/api/admin/payments/finance-beta", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: detail("finance-beta", "Beta") }),
    }),
  );
  await page.goto("/admin/payments");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("row", { name: /Alpha Customer/ }).click();
  await expect(page.getByRole("heading", { name: "Alpha order" })).toBeVisible();
  await page.getByRole("textbox", { name: "Refund amount" }).fill("12.00");
  await page.getByRole("row", { name: /Beta Customer/ }).click();
  await expect(page.getByRole("heading", { name: "Beta order" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Refund amount" })).toHaveValue("");
  await page.goBack();
  await expect(page).toHaveURL(/payment=finance-alpha/);
  await expect(page.getByRole("heading", { name: "Beta order" })).toHaveCount(0);
  await expect.poll(() => alphaReads).toBe(2);
  releaseAlpha();
  await expect(page.getByRole("heading", { name: "Alpha order" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Refund amount" })).toHaveValue("");
  await page.getByRole("button", { name: "Close payment details" }).click();
  await page
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page).toHaveURL(/cursor=finance-page-two/);
  await expect(page.getByRole("navigation", { name: "Results pagination" })).toContainText(
    "Page 2",
  );
  await page.getByRole("row", { name: /Beta Customer/ }).click();
  await expect(page).toHaveURL(
    /cursor=finance-page-two.*payment=finance-beta|payment=finance-beta.*cursor=finance-page-two/,
  );
  await expect(page.getByRole("heading", { name: "Beta order" })).toBeVisible();
  await page.getByRole("button", { name: "Close payment details" }).click();
  await page
    .getByRole("navigation", { name: "Results pagination" })
    .getByRole("button", { name: "Previous" })
    .click();
  await expect(page).not.toHaveURL(/cursor=finance-page-two/);
  await expect(page.getByRole("navigation", { name: "Results pagination" })).toContainText(
    "Page 1",
  );
  await page.screenshot({ path: testInfo.outputPath("finance-payments-1440.png"), fullPage: true });
});

test("Finance issue selection clears the previous recovery action and reason", async ({
  adminPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const issues = [
    {
      groupKey: "finance-issue-alpha",
      paymentIntentId: "finance-alpha",
      customerName: "Alpha Customer",
      customerEmail: null,
      amountMinor: 4200,
      currency: "PHP",
      problem: "Payment needs a provider check",
      state: "NEEDS_ATTENTION",
      caseIds: ["case-alpha"],
      actions: [
        {
          kind: "RECHECK_PAYMENT",
          caseId: null,
          refundId: null,
          expectedVersion: 1,
          expectedPaymentVersion: null,
          expectedRecoveryVersion: 1,
        },
      ],
      openedAt: createdAt,
    },
    {
      groupKey: "finance-issue-beta",
      paymentIntentId: "finance-beta",
      customerName: "Beta Customer",
      customerEmail: null,
      amountMinor: 1200,
      currency: "PHP",
      problem: "Provider event needs review",
      state: "NEEDS_ATTENTION",
      caseIds: ["case-beta"],
      actions: [
        {
          kind: "RETRY_PROVIDER_EVENT",
          caseId: "case-beta",
          refundId: null,
          expectedVersion: 1,
          expectedPaymentVersion: null,
          expectedRecoveryVersion: null,
        },
      ],
      openedAt: createdAt,
    },
  ];
  await page.route("**/api/admin/payments/attention?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: { items: issues, total: 2, nextCursor: null } }),
    }),
  );
  await page.goto("/admin/payments");
  await page.getByRole("tab", { name: /Needs attention/ }).click();
  await page.getByRole("row", { name: /Alpha Customer/ }).click();
  await page.getByRole("button", { name: "Check payment status" }).click();
  await page.getByRole("textbox", { name: "Recovery reason" }).fill("Check alpha");
  await page.getByRole("row", { name: /Beta Customer/ }).click();
  await expect(page.getByRole("button", { name: "Retry provider event" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check payment status" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Recovery reason" })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/issue=finance-issue-alpha/);
  await expect(page.getByRole("button", { name: "Check payment status" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Recovery reason" })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("finance-attention-1440.png"),
    fullPage: true,
  });
});

test("Finance ignores a delayed Refresh after switching to Needs attention", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let holdList = false;
  let refreshStarted = false;
  let releaseRefresh!: () => void;
  const heldRefresh = new Promise<void>((resolve) => (releaseRefresh = resolve));
  await page.route("**/api/admin/payments?**", async (route) => {
    if (holdList) {
      refreshStarted = true;
      await heldRefresh;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: { items: [payment("finance-alpha", "Alpha")], nextCursor: null },
      }),
    });
  });
  await page.route("**/api/admin/payments/finance-alpha", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: detail("finance-alpha", "Alpha") }),
    }),
  );
  await page.route("**/api/admin/payments/attention?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: { items: [], total: 0, nextCursor: null } }),
    }),
  );
  await page.goto("/admin/payments");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("row", { name: /Alpha Customer/ }).click();
  await expect(page.getByRole("heading", { name: "Alpha order" })).toBeVisible();
  holdList = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => refreshStarted).toBe(true);
  await page.getByRole("tab", { name: /Needs attention/ }).click();
  releaseRefresh();
  await expect(page.getByText("No payments need attention")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alpha order" })).toHaveCount(0);
  await expect(page).toHaveURL(/tab=attention/);
});

test("Finance keeps the paid list while payment details fail and recover", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/admin/payments?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: { items: [payment("finance-alpha", "Alpha")], nextCursor: null },
      }),
    }),
  );
  let reads = 0;
  let releaseRead!: () => void;
  const heldRead = new Promise<void>((resolve) => (releaseRead = resolve));
  await page.route("**/api/admin/payments/finance-alpha", async (route) => {
    reads += 1;
    if (reads === 1) {
      await heldRead;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Payment details are outside current access.",
            requestId: "finance-detail-denied",
          },
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: detail("finance-alpha", "Alpha") }),
    });
  });
  await page.goto("/admin/payments");
  await page.getByRole("button", { name: "Refresh" }).click();
  const row = page.getByRole("row", { name: /Alpha Customer/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("heading", { name: "Payment details" })).toBeVisible();
  await expect(page.getByText("Loading payment details")).toBeVisible();
  await expect(row).toBeVisible();
  releaseRead();
  await expect(page.getByText("Payment details are outside current access.")).toBeVisible();
  await expect(page.getByText("Request reference: finance-detail-denied")).toBeVisible();
  await expect(row).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments could not be loaded" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Alpha order" })).toBeVisible();
  await expect(row).toBeVisible();
});

test("Finance removes stale refund actions when a detail refresh is denied", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/admin/payments?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: { items: [payment("finance-alpha", "Alpha")], nextCursor: null },
      }),
    }),
  );
  let denyDetail = false;
  await page.route("**/api/admin/payments/finance-alpha", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        denyDetail
          ? {
              ok: false,
              error: {
                code: "FORBIDDEN",
                message: "Payment detail access has changed.",
                requestId: "finance-access-changed",
              },
            }
          : { ok: true, value: detail("finance-alpha", "Alpha") },
      ),
    }),
  );
  await page.goto("/admin/payments");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("row", { name: /Alpha Customer/ }).click();
  await expect(page.getByRole("textbox", { name: "Refund amount" })).toBeVisible();
  denyDetail = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Payment detail access has changed.")).toBeVisible();
  await expect(page.getByText("Request reference: finance-access-changed")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Refund amount" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refund", exact: true })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Alpha Customer/ })).toBeVisible();
  denyDetail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("textbox", { name: "Refund amount" })).toBeVisible();
});
