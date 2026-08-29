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
  const data = { email: `staff-${crypto.randomUUID()}@example.com`, displayName: "E2E Staff" };
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
