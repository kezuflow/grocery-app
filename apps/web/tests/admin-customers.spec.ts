import { expect, test } from "./admin-authenticated-fixture";

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
