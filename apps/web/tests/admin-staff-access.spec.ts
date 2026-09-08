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
  test(`operator creates and safely revokes an invitation after a lost response at ${width}px`, async ({
    adminPage,
  }, testInfo) => {
    await adminPage.setViewportSize({ width, height: 900 });
    const name = `Revocation reader ${width}`;
    const role = await (
      await adminPage.request.post("/api/admin/roles", {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: {
          code: `revoke-reader-${crypto.randomUUID()}`,
          name,
          description: "Browser revocation",
          capabilityCodes: ["inventory.read"],
        },
      })
    ).json();
    expect(role).toMatchObject({ ok: true });
    const displayName = `Withdrawn operator ${width}`;
    await adminPage.goto("/admin/staff");
    await adminPage
      .getByRole("textbox", { name: "Invitee email" })
      .fill(`withdrawn-${crypto.randomUUID()}@example.com`);
    await adminPage.getByRole("textbox", { name: "Invitee display name" }).fill(displayName);
    await adminPage.getByRole("combobox", { name: "Invitation role" }).click();
    await adminPage.getByRole("option", { name, exact: true }).click();
    await adminPage.getByRole("combobox", { name: "Invitation scope" }).click();
    await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await adminPage.getByRole("button", { name: "Create invitation", exact: true }).click();
    const row = adminPage.getByRole("listitem").filter({ hasText: displayName });
    await expect(row).toContainText("PENDING");
    await adminPage
      .getByRole("textbox", { name: "Invitation revocation reason" })
      .fill("Assignment withdrawn");
    const requests: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route("**/api/admin/staff/invitations/*/revoke", async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({
        ok: true,
        value: { status: "REVOKED", version: 2 },
      });
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await row.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(
      adminPage.getByText(
        "The action could not be confirmed. Retry the original request before starting another action.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(row.getByRole("button", { name: "Revoke", exact: true })).toBeDisabled();
    await adminPage
      .getByRole("textbox", { name: "Invitation revocation reason" })
      .fill("Edited after uncertainty");
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(row).toContainText("REVOKED");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(JSON.parse(requests[0]?.body ?? "null")).toEqual({
      reason: "Assignment withdrawn",
      expectedVersion: 1,
    });
    expect(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await adminPage.screenshot({
      path: testInfo.outputPath("staff-invitation-revoked.png"),
      fullPage: true,
    });
  });
  test(`verified invitee reviews grants and retries lost acceptance at ${width}px`, async ({
    adminPage,
    signedInPage,
  }, testInfo) => {
    await signedInPage.setViewportSize({ width, height: 900 });
    const session = await (await signedInPage.request.get("/api/auth/get-session")).json();
    expect(session.user.emailVerified).toBe(true);
    await adminPage.setViewportSize({ width, height: 900 });
    await adminPage.goto("/admin/staff/roles");
    const roleCode = `local-reader-${crypto.randomUUID()}`;
    const creations: { key: string | undefined; body: string | null }[] = [];
    let createdRoleId = "";
    await adminPage.route("**/api/admin/roles", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      creations.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      const result = await response.json();
      expect(result).toMatchObject({ ok: true });
      createdRoleId = result.value.roleId;
      if (creations.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await adminPage.getByRole("textbox", { name: "Role code", exact: true }).fill(roleCode);
    await adminPage
      .getByRole("textbox", { name: "Role name", exact: true })
      .fill("Local inventory reader");
    await adminPage.getByRole("button", { name: "Create role", exact: true }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    const roleRow = adminPage.getByRole("row").filter({ hasText: roleCode });
    await expect(roleRow).toBeVisible();
    expect(creations).toHaveLength(2);
    expect(creations[1]).toEqual(creations[0]);
    await roleRow.getByRole("link", { name: "Edit", exact: true }).click();
    await adminPage.getByRole("checkbox", { name: /^inventory.read / }).click();
    await expect(adminPage.getByRole("checkbox", { name: /^inventory.read / })).toBeChecked();
    const role = await (await adminPage.request.get(`/api/admin/roles/${createdRoleId}`)).json();
    expect(role).toMatchObject({ ok: true, value: { capabilityCodes: ["inventory.read"] } });
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
    let acceptedStaffId = "";
    await signedInPage.route("**/api/staff-invitation", async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      const receipt = await response.json();
      expect(receipt).toMatchObject({ ok: true });
      acceptedStaffId = receipt.value.staffId;
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
    await adminPage.setViewportSize({ width, height: 900 });
    await adminPage.goto(`/admin/staff/${acceptedStaffId}`);
    await adminPage.getByRole("textbox", { name: "Staff display name" }).fill("Renamed operator");
    await adminPage.getByRole("button", { name: "Save profile" }).click();
    await expect(
      adminPage.getByRole("heading", { name: "Renamed operator", exact: true }),
    ).toBeVisible();
    const accessRequests: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route(`**/api/admin/staff/${acceptedStaffId}/access`, async (route) => {
      accessRequests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (accessRequests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await adminPage
      .getByRole("textbox", { name: "Reason for access change" })
      .fill("Temporary leave");
    await adminPage.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Save profile" })).toBeDisabled();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(adminPage.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
    expect(accessRequests).toHaveLength(2);
    expect(accessRequests[1]).toEqual(accessRequests[0]);
    await adminPage
      .getByRole("textbox", { name: "Reason for access change" })
      .fill("Returned to work");
    await adminPage.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(adminPage.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();
    // Keep a real bounded role page so the previously assigned role is off-page.
    await adminPage.route("**/api/admin/roles?*", async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set("limit", "1");
      await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
    });
    await adminPage.reload();
    const roleRequests: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route(`**/api/admin/staff/${acceptedStaffId}/roles`, async (route) => {
      roleRequests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      const result = await response.json();
      expect(result).toMatchObject({ ok: true });
      expect(result.value.roleIds).toContain(role.value.roleId);
      expect(result.value.roleIds).toHaveLength(2);
      if (roleRequests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await adminPage.getByRole("checkbox").first().click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(adminPage.getByRole("checkbox").first()).toBeChecked();
    expect(roleRequests).toHaveLength(2);
    expect(roleRequests[1]).toEqual(roleRequests[0]);
    await adminPage.getByRole("button", { name: "Set global", exact: true }).click();
    await expect(adminPage.getByRole("textbox", { name: "Location ID" })).toHaveValue("");
    await adminPage.getByRole("textbox", { name: "Location ID" }).fill("location-cebu-central");
    await adminPage.getByRole("button", { name: "Set location", exact: true }).click();
    await expect(
      adminPage.getByText('Current: {"kind":"location","locationId":"location-cebu-central"}', {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await adminPage.screenshot({
      path: testInfo.outputPath("staff-lifecycle.png"),
      fullPage: true,
    });
    const sessionRequests: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route(
      `**/api/admin/staff/${acceptedStaffId}/sessions/revoke`,
      async (route) => {
        sessionRequests.push({
          key: route.request().headers()["idempotency-key"],
          body: route.request().postData(),
        });
        const response = await route.fetch();
        const result = await response.json();
        expect(result).toMatchObject({ ok: true });
        expect(result.value.revokedSessionCount).toBeGreaterThan(0);
        if (sessionRequests.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await adminPage
      .getByRole("textbox", { name: "Reason for access change" })
      .fill("Session security review");
    await adminPage.getByRole("button", { name: "Revoke sessions", exact: true }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toHaveCount(
      0,
    );
    expect(sessionRequests).toHaveLength(2);
    expect(sessionRequests[1]).toEqual(sessionRequests[0]);
    expect(await (await signedInPage.request.get("/api/auth/get-session")).json()).toBeNull();
    await adminPage.goto(`/admin/staff/roles/${role.value.roleId}`);
    await adminPage
      .getByRole("textbox", { name: "Role name", exact: true })
      .fill("Reviewed inventory role");
    await adminPage.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      adminPage.getByRole("heading", { name: "Reviewed inventory role", exact: true }),
    ).toBeVisible();
    await adminPage.getByRole("checkbox", { name: /^orders.read / }).click();
    await expect(adminPage.getByRole("checkbox", { name: /^orders.read / })).toBeChecked();
    const archives: { key: string | undefined; body: string | null }[] = [];
    await adminPage.route(`**/api/admin/roles/${role.value.roleId}/archive`, async (route) => {
      archives.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true, value: { status: "ARCHIVED" } });
      if (archives.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await adminPage.getByRole("textbox", { name: "Archive reason" }).fill("Replaced role");
    await adminPage.getByRole("button", { name: "Archive role", exact: true }).click();
    await expect(adminPage.getByRole("button", { name: "Retry unconfirmed action" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(adminPage.getByText("ARCHIVED", { exact: true })).toBeVisible();
    expect(archives).toHaveLength(2);
    expect(archives[1]).toEqual(archives[0]);
    await expect(adminPage.getByRole("checkbox", { name: /^orders.read / })).toBeDisabled();
    expect(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await adminPage.screenshot({ path: testInfo.outputPath("role-archived.png"), fullPage: true });
  });
}
