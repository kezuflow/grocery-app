import { expect, test } from "./admin-authenticated-fixture";

/**
 * Staff & Access workspace flows against a provisioned local stack. Skips
 * when the app is unreachable. Authenticated journeys use the deterministic
 * local Staff fixture configured by Playwright.
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

test("an unauthenticated visitor cannot open the staff workspace", async ({ page }) => {
  await page.goto("/admin/staff");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("an unauthenticated visitor cannot open the roles workspace", async ({ page }) => {
  await page.goto("/admin/staff/roles");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("a provisioned Staff reader opens the real Staff workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/staff");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Staff & Access" })).toBeVisible();
});

test("a Staff principal without capability is denied the Staff workspace", async ({
  deniedAdminPage,
}) => {
  await deniedAdminPage.goto("/admin/staff");
  await expect(deniedAdminPage.getByRole("alert")).toContainText(/requires.*staff\.read/i);
});

test("staff invitation succeeds with capability and is denied without it", async ({
  adminPage,
  deniedAdminPage,
}) => {
  const role = await adminPage.request.post("/api/admin/roles", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      code: `reader-${crypto.randomUUID()}`,
      name: "Invited reader",
      description: "Browser acceptance",
      capabilityCodes: ["inventory.read"],
    },
  });
  const createdRole = await role.json();
  expect(createdRole).toMatchObject({ ok: true });
  const data = {
    email: `staff-${crypto.randomUUID()}@example.com`,
    displayName: "E2E Staff",
    roleIds: [createdRole.value.roleId],
    scopes: [{ kind: "location", locationId: "location-cebu-central" }],
  };
  const headers = { "idempotency-key": crypto.randomUUID() };
  const allowed = await adminPage.request.post("/api/admin/staff/invitations", { data, headers });
  const allowedBody = await allowed.json();
  expect(allowedBody, JSON.stringify(allowedBody)).toMatchObject({
    ok: true,
    value: { email: data.email },
  });
  const denied = await deniedAdminPage.request.post("/api/admin/staff/invitations", {
    data: { ...data, email: `denied-${data.email}` },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});

for (const width of [1440, 390]) {
  test(`verified invitee reviews grants and retries lost acceptance at ${width}px`, async ({
    adminPage,
    signedInPage,
  }, testInfo) => {
    await signedInPage.setViewportSize({ width, height: 900 });
    const session = await (await signedInPage.request.get("/api/auth/get-session")).json();
    expect(session.user.emailVerified).toBe(true);
    const role = await (
      await adminPage.request.post("/api/admin/roles", {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: {
          code: `local-reader-${crypto.randomUUID()}`,
          name: "Local inventory reader",
          description: "Browser onboarding",
          capabilityCodes: ["inventory.read"],
        },
      })
    ).json();
    expect(role).toMatchObject({ ok: true });
    const invitation = await (
      await adminPage.request.post("/api/admin/staff/invitations", {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: {
          email: session.user.email,
          displayName: "Invited operator",
          roleIds: [role.value.roleId],
          scopes: [{ kind: "location", locationId: "location-cebu-central" }],
        },
      })
    ).json();
    expect(invitation).toMatchObject({ ok: true });
    await signedInPage.goto("/staff-invitation");
    await expect(signedInPage.getByText("Local inventory reader", { exact: true })).toBeVisible();
    await expect(signedInPage.getByRole("heading", { name: "Locations and scope" })).toBeVisible();
    const requests: { key: string | undefined; body: string | null }[] = [];
    await signedInPage.route("**/api/staff-invitation", async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await signedInPage.getByRole("button", { name: "Accept staff invitation" }).click();
    await expect(signedInPage.getByRole("status")).toContainText(
      "Acceptance could not be confirmed",
    );
    await signedInPage.getByRole("button", { name: "Accept staff invitation" }).click();
    await expect(signedInPage.getByRole("status")).toContainText("Staff access is ready");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]?.key).toBeTruthy();
    expect(
      await signedInPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await signedInPage.screenshot({
      path: testInfo.outputPath("staff-invitation-accepted.png"),
      fullPage: true,
    });
    const denied = await (await signedInPage.request.get("/api/admin/staff")).json();
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await signedInPage.reload();
    await expect(
      signedInPage.getByText("No pending staff invitation is available for your verified email."),
    ).toBeVisible();
  });
}
