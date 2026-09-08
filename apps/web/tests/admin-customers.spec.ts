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
    await expect(adminPage.getByText(session.user.email, { exact: true })).toBeVisible();
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
    await adminPage.getByRole("button", { name: "Load more invitations" }).click();
    await expect(
      adminPage.getByRole("article").filter({ hasText: session.user.email }),
    ).toContainText("ACCEPTED");
    expect(revocations).toHaveLength(2);
    expect(revocations[1]).toEqual(revocations[0]);
    await adminPage.goto(`/admin/customers/${acceptedCustomerId}`);
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
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(adminPage.getByRole("button", { name: "Restore access" })).toBeVisible();
    expect(accessRequests).toHaveLength(2);
    expect(accessRequests[1]).toEqual(accessRequests[0]);
    expect(await (await signedInPage.request.get("/api/commerce/address")).json()).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    await adminPage.getByRole("button", { name: "Restore access" }).click();
    await expect(adminPage.getByRole("button", { name: "Disable access" })).toBeVisible();
    expect(await (await signedInPage.request.get("/api/commerce/address")).json()).toMatchObject({
      ok: true,
    });
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
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toHaveCount(
      0,
    );
    expect(sessionRequests).toHaveLength(2);
    expect(sessionRequests[1]).toEqual(sessionRequests[0]);
    await expect(
      adminPage.getByRole("cell", { name: "CUSTOMER.SESSIONS_REVOKED", exact: true }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("cell", { name: "CUSTOMER.ACCESS_CHANGED", exact: true }),
    ).toHaveCount(2);
    expect(await (await signedInPage.request.get("/api/auth/get-session")).json()).toBeNull();
    expect(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await adminPage.screenshot({
      path: testInfo.outputPath("customer-access-recovered.png"),
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
