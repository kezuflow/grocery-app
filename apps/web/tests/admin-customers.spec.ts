import { expect, test } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`verified customer accepts an invitation after a lost response at ${width}px`, async ({
    adminPage,
    signedInPage,
  }, testInfo) => {
    await signedInPage.setViewportSize({ width, height: 900 });
    const session = await (await signedInPage.request.get("/api/auth/get-session")).json();
    expect(session.user.emailVerified).toBe(true);
    await adminPage.setViewportSize({ width, height: 900 });
    await adminPage.goto("/admin/customers");
    await adminPage.getByRole("button", { name: "Invite customer" }).click();
    await adminPage
      .getByRole("textbox", { name: "Email address", exact: true })
      .fill(session.user.email);
    let invitationId = "";
    const creations: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route(/\/api\/admin\/customers\/invitations(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        const url = new URL(route.request().url());
        url.searchParams.set("limit", "1");
        const response = await route.fetch({ url: url.toString() });
        return route.fulfill({ response });
      }
      creations.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      const result = await response.json();
      expect(result).toMatchObject({ ok: true });
      invitationId = result.value.invitationId;
      if (creations.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await adminPage.getByRole("button", { name: "Create invitation", exact: true }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(
      adminPage.getByRole("link", { name: session.user.email, exact: true }),
    ).toBeVisible();
    expect(creations).toHaveLength(2);
    expect(creations[1]).toEqual(creations[0]);
    const acceptedInvitationId = invitationId;
    await signedInPage.goto("/customer-invitation");
    await expect(
      signedInPage.getByRole("heading", { name: "Welcome to FreshMarkets" }),
    ).toBeVisible();
    const requests: { key: string | undefined; body: string | null }[] = [];
    let acceptedCustomerId = "";
    await signedInPage.route("**/api/customer-invitation", async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      const acceptedResult = await response.json();
      expect(acceptedResult).toMatchObject({ ok: true });
      acceptedCustomerId = acceptedResult.value.customerId;
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await signedInPage.getByRole("button", { name: "Accept customer invitation" }).click();
    await expect(signedInPage.getByRole("status")).toContainText(
      "Acceptance could not be confirmed",
    );
    await signedInPage.getByRole("button", { name: "Accept customer invitation" }).click();
    await expect(signedInPage.getByRole("status")).toContainText("Your customer account is ready");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]?.key).toBeTruthy();
    await adminPage.goto(`/admin/customers?query=${encodeURIComponent(session.user.email)}`);
    await expect(adminPage.getByRole("textbox", { name: "Search customers" })).toHaveValue(
      session.user.email,
    );
    const customerLink = adminPage
      .getByRole(width < 640 ? "list" : "table", { name: "Customer list" })
      .getByRole("link", { name: session.user.email, exact: true });
    await expect(customerLink).toBeVisible();
    if (process.env.SAUI_CAPTURE_CUSTOMERS === "1") {
      await adminPage.screenshot({
        path: `../../docs/operations/checkpoints/evidence/saui-05/customers-index-${width}.png`,
        fullPage: true,
      });
    }
    await customerLink.click();
    await expect(adminPage).toHaveURL(new RegExp(`/admin/customers/${acceptedCustomerId}\\?`));
    await adminPage.getByRole("main").getByRole("link", { name: "Customers", exact: true }).click();
    await expect(adminPage).toHaveURL(
      `/admin/customers?query=${encodeURIComponent(session.user.email)}`,
    );
    await expect(adminPage.getByRole("textbox", { name: "Search customers" })).toHaveValue(
      session.user.email,
    );
    await adminPage.getByRole("button", { name: "Invite customer" }).click();
    expect(
      await signedInPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await signedInPage.screenshot({
      path: testInfo.outputPath("customer-invitation-accepted.png"),
      fullPage: true,
    });
    await signedInPage.getByRole("link", { name: "Add your delivery address" }).click();
    await expect(signedInPage).toHaveURL(/\/account\/addresses$/);
    const queue = await (
      await adminPage.request.get("/api/admin/customers/invitations?limit=100")
    ).json();
    expect(queue).toMatchObject({
      ok: true,
      value: {
        items: expect.arrayContaining([
          expect.objectContaining({
            invitationId: acceptedInvitationId,
            status: "ACCEPTED",
          }),
        ]),
      },
    });
    const withdrawnEmail = `withdrawn-${crypto.randomUUID()}@example.com`;
    await adminPage
      .getByRole("textbox", { name: "Email address", exact: true })
      .fill(withdrawnEmail);
    await adminPage.getByRole("button", { name: "Create invitation", exact: true }).click();
    const withdrawn = adminPage.getByRole("article").filter({ hasText: withdrawnEmail });
    await expect(withdrawn).toBeVisible();
    await expect(withdrawn).toContainText("Invitation email queued.");
    await withdrawn.getByRole("textbox").fill("Incorrect email address");
    const revocations: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route("**/api/admin/customers/invitations/revoke", async (route) => {
      revocations.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true, value: { status: "REVOKED" } });
      if (revocations.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await withdrawn.getByRole("button", { name: "Revoke invitation" }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(withdrawn).toContainText("REVOKED");
    await expect(withdrawn).toContainText("Pending invitation email canceled.");
    await adminPage.getByRole("button", { name: "Load more invitations" }).click();
    await expect(
      adminPage.getByRole("article").filter({ hasText: session.user.email }),
    ).toContainText("ACCEPTED");
    expect(revocations).toHaveLength(2);
    expect(revocations[1]).toEqual(revocations[0]);
    await adminPage.goto(`/admin/customers/${acceptedCustomerId}`);
    await expect(
      adminPage.getByRole("heading", { level: 1, name: session.user.email }),
    ).toBeVisible();
    if (process.env.SAUI_CAPTURE_CUSTOMERS === "1") {
      await adminPage.screenshot({
        path: `../../docs/operations/checkpoints/evidence/saui-05/customer-record-${width}.png`,
        fullPage: true,
      });
    }
    await adminPage
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Customer access review");
    const accessRequests: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route(`**/api/admin/customers/${acceptedCustomerId}/access`, async (route) => {
      accessRequests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (accessRequests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await adminPage.getByRole("button", { name: "Disable access" }).click();
    const accessDialog = adminPage.getByRole("alertdialog");
    await expect(accessDialog).toContainText(
      "Existing Orders and financial records stay unchanged",
    );
    await expect(
      accessDialog.getByRole("textbox", { name: "Confirmation reason" }),
    ).toHaveAttribute("maxlength", "500");
    await accessDialog
      .getByRole("textbox", { name: "Confirmation reason" })
      .fill("Access review confirmed in dialog");
    await accessDialog.getByRole("button", { name: "Disable access" }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await expect(adminPage.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue(
      "Access review confirmed in dialog",
    );
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(adminPage.getByRole("button", { name: "Restore access" })).toBeVisible();
    expect(accessRequests).toHaveLength(2);
    expect(accessRequests[1]).toEqual(accessRequests[0]);
    expect(await (await signedInPage.request.get("/api/commerce/address")).json()).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    await adminPage
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Restore after access review");
    await adminPage.getByRole("button", { name: "Restore access" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Restore access" })
      .click();
    await expect(adminPage.getByRole("button", { name: "Disable access" })).toBeVisible();
    expect(await (await signedInPage.request.get("/api/commerce/address")).json()).toMatchObject({
      ok: true,
    });
    await adminPage
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("End all reviewed sessions");
    const sessionRequests: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route(
      `**/api/admin/customers/${acceptedCustomerId}/sessions/revoke`,
      async (route) => {
        sessionRequests.push({
          key: route.request().headers()["idempotency-key"],
          body: route.request().postData(),
        });
        const response = await route.fetch();
        expect(await response.json()).toMatchObject({ ok: true });
        if (sessionRequests.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await adminPage.getByRole("button", { name: "Revoke sessions" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Revoke sessions" })
      .click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toHaveCount(
      0,
    );
    expect(sessionRequests).toHaveLength(2);
    expect(sessionRequests[1]).toEqual(sessionRequests[0]);
    await expect(adminPage.getByText("CUSTOMER.SESSIONS_REVOKED", { exact: true })).toBeVisible();
    await expect(adminPage.getByText("CUSTOMER.ACCESS_CHANGED", { exact: true })).toHaveCount(2);
    expect(await (await signedInPage.request.get("/api/auth/get-session")).json()).toBeNull();
    expect(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await adminPage.screenshot({
      path: testInfo.outputPath("customer-access-recovered.png"),
      fullPage: true,
    });
    const login = await signedInPage.request.post("/api/auth/sign-in/email", {
      headers: { origin: new URL(signedInPage.url()).origin },
      data: { email: session.user.email, password: "correct-horse-battery-staple" },
    });
    expect(login.status()).toBe(200);
    await adminPage
      .getByRole("textbox", { name: "Privacy request reason", exact: true })
      .fill("Customer requested commerce closure");
    await adminPage.getByRole("button", { name: "Open privacy request" }).click();
    const privacy = adminPage.getByRole("article", {
      name: "Commerce access closure request",
      exact: true,
    });
    await expect(privacy).toContainText("Status: SUBMITTED");
    for (const [action, status] of [
      ["Begin identity review", "VERIFYING"],
      ["Approve request", "APPROVED"],
      ["Begin processing", "PROCESSING"],
    ]) {
      await privacy
        .getByRole("textbox", {
          name: "Action reason for Commerce access closure request",
          exact: true,
        })
        .fill(`${action} confirmed with customer`);
      await privacy.getByRole("button", { name: action, exact: true }).click();
      await expect(privacy).toContainText(`Status: ${status}`);
    }
    const completions: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route(/\/api\/admin\/privacy-requests\/[^/]+\/actions$/, async (route) => {
      completions.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true, value: { status: "COMPLETED" } });
      if (completions.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await privacy
      .getByRole("textbox", {
        name: "Action reason for Commerce access closure request",
        exact: true,
      })
      .fill("Customer confirmed closure; retained history preserved");
    await privacy.getByRole("button", { name: "Close commerce access" }).click();
    const closureDialog = adminPage.getByRole("alertdialog");
    await expect(closureDialog).toContainText(
      "does not cancel Orders or initiate financial effects",
    );
    await expect(
      closureDialog.getByRole("textbox", { name: "Confirmation reason" }),
    ).toHaveAttribute("maxlength", "500");
    await closureDialog
      .getByRole("textbox", { name: "Confirmation reason" })
      .fill("Closure completion confirmed in dialog");
    await closureDialog.getByRole("button", { name: "Close commerce access" }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await expect(
      privacy.getByRole("textbox", { name: "Action reason for Commerce access closure request" }),
    ).toHaveValue("Closure completion confirmed in dialog");
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(privacy).toContainText("Status: COMPLETED");
    expect(completions).toHaveLength(2);
    expect(completions[1]).toEqual(completions[0]);
    await expect(adminPage.getByRole("button", { name: "Restore access" })).toBeVisible();
    await expect(adminPage.getByText("CUSTOMER.CLOSED", { exact: true })).toBeVisible();
    expect(await (await signedInPage.request.get("/api/auth/get-session")).json()).toBeNull();
    await adminPage.screenshot({
      path: testInfo.outputPath("customer-closure-completed.png"),
      fullPage: true,
    });
  });
}

/**
 * Customer CRM workspace flows against a provisioned local stack. Skips when
 * the app is unreachable. Authenticated journeys use the deterministic local
 * Staff fixture configured by Playwright.
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

test("an unauthenticated visitor cannot open the customers workspace", async ({ page }) => {
  await page.goto("/admin/customers");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("a provisioned Staff reader opens the real Customer workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/customers");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
});

test("a Staff principal without capability is denied the Customer workspace", async ({
  deniedAdminPage,
}) => {
  await deniedAdminPage.goto("/admin/customers");
  await expect(deniedAdminPage.getByRole("alert")).toContainText(/requires.*customers\.read/i);
});

test("customer invitation succeeds with capability and is denied without it", async ({
  adminPage,
  deniedAdminPage,
}) => {
  const data = { email: `customer-${crypto.randomUUID()}@example.com` };
  const allowed = await adminPage.request.post("/api/admin/customers/invitations", {
    data,
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  const allowedBody = await allowed.json();
  expect(allowedBody, JSON.stringify(allowedBody)).toMatchObject({
    ok: true,
    value: { email: data.email },
  });
  const denied = await deniedAdminPage.request.post("/api/admin/customers/invitations", {
    data: { email: `denied-${data.email}` },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});

test("a customers.read-only Staff member sees the list without invitation controls", async ({
  customersReadOnlyPage,
}) => {
  await customersReadOnlyPage.goto("/admin/customers");
  await expect(
    customersReadOnlyPage.getByRole("heading", { level: 1, name: "Customers" }),
  ).toBeVisible();
  await expect(customersReadOnlyPage.getByRole("button", { name: "Invite customer" })).toHaveCount(
    0,
  );
  await expect(
    customersReadOnlyPage.getByRole("textbox", { name: "Search customers" }),
  ).toBeVisible();
  await customersReadOnlyPage.goto("/admin/customers?query=example.com");
  await expect(
    customersReadOnlyPage.getByRole("textbox", { name: "Search customers" }),
  ).toHaveValue("example.com");
  await expect(customersReadOnlyPage.getByRole("button", { name: "Invite customer" })).toHaveCount(
    0,
  );
  const result = await (
    await customersReadOnlyPage.request.get("/api/admin/customers?limit=1")
  ).json();
  expect(result).toMatchObject({ ok: true });
  const customer = result.value.items[0] as { customerId: string; email: string } | undefined;
  expect(customer).toBeTruthy();
  await customersReadOnlyPage.goto(`/admin/customers/${customer?.customerId}`);
  await expect(
    customersReadOnlyPage.getByRole("heading", { level: 1, name: customer?.email }),
  ).toBeVisible();
  await expect(
    customersReadOnlyPage.getByText(/review this record.*customers\.manage/i),
  ).toBeVisible();
  await expect(customersReadOnlyPage.getByRole("button", { name: "Disable access" })).toHaveCount(
    0,
  );
  await expect(
    customersReadOnlyPage.getByRole("button", { name: "Open privacy request" }),
  ).toHaveCount(0);
  await expect(
    customersReadOnlyPage.getByRole("button", { name: "Save customer preferences" }),
  ).toHaveCount(0);
  await expect(customersReadOnlyPage.getByRole("button", { name: "Add support note" })).toHaveCount(
    0,
  );
});

test("Customer detail keeps missing, denied, and load failures distinct", async ({ adminPage }) => {
  const missingId = crypto.randomUUID();
  const deniedId = crypto.randomUUID();
  const failedId = crypto.randomUUID();
  await adminPage.route(`**/api/admin/customers/${missingId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: "Customer not found", requestId: "missing" },
      }),
    }),
  );
  await adminPage.goto(`/admin/customers/${missingId}`);
  await expect(adminPage.getByText("Customer not found", { exact: true })).toBeVisible();

  await adminPage.route(`**/api/admin/customers/${deniedId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "FORBIDDEN", message: "Customer access denied", requestId: "denied" },
      }),
    }),
  );
  await adminPage.goto(`/admin/customers/${deniedId}`);
  await expect(adminPage.getByText("Customer access denied", { exact: true })).toBeVisible();

  await adminPage.route(`**/api/admin/customers/${failedId}`, (route) => route.abort("failed"));
  await adminPage.goto(`/admin/customers/${failedId}`);
  await expect(adminPage.getByText("Customer record unavailable", { exact: true })).toBeVisible();
  await expect(adminPage.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("Customers ignores an older failed query after a newer search succeeds", async ({
  adminPage,
}) => {
  await adminPage.goto("/admin/customers");
  await expect(adminPage.getByRole("textbox", { name: "Search customers" })).toBeVisible();
  let releaseOld: (() => void) | undefined;
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let oldStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    oldStarted = resolve;
  });
  let oldFinished: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => {
    oldFinished = resolve;
  });
  await adminPage.route("**/api/admin/customers?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    if (query === "old@example.com") {
      oldStarted?.();
      await oldGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "Old query failed", requestId: "old" },
        }),
      });
      oldFinished?.();
      return;
    }
    if (query === "new@example.com") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, value: { items: [], nextCursor: null } }),
      });
      return;
    }
    await route.continue();
  });
  await adminPage.getByRole("textbox", { name: "Search customers" }).fill("old@example.com");
  await adminPage.getByRole("button", { name: "Search", exact: true }).click();
  await started;
  await adminPage.getByRole("textbox", { name: "Search customers" }).fill("new@example.com");
  await adminPage.getByRole("button", { name: "Search", exact: true }).click();
  await expect(adminPage.getByText("No customers are visible in this view.")).toBeVisible();
  releaseOld?.();
  await finished;
  await expect(adminPage.getByText("Old query failed")).toHaveCount(0);
  await expect(adminPage.getByRole("textbox", { name: "Search customers" })).toHaveValue(
    "new@example.com",
  );
});
