import { expect, test } from "./admin-authenticated-fixture";

/**
 * Promotions workspace flows against a provisioned local stack. Skips when
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

test("an unauthenticated visitor cannot open the promotions workspace", async ({ page }) => {
  await page.goto("/admin/promotions");
  await expect(page.getByRole("alert")).toContainText("staff account");
});

test("a provisioned Staff reader opens the real Promotions workspace", async ({ adminPage }) => {
  await adminPage.goto("/admin/promotions");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Promotions" })).toBeVisible();
});

test("a Staff principal without capability is denied the Promotions workspace", async ({
  deniedAdminPage,
}) => {
  await deniedAdminPage.goto("/admin/promotions");
  await expect(deniedAdminPage.getByRole("alert")).toContainText(/requires.*promotions\.read/i);
});

test("promotion creation succeeds with capability and is denied without it", async ({
  adminPage,
  deniedAdminPage,
}) => {
  const suffix = crypto.randomUUID();
  const codeSuffix = suffix.replaceAll("-", "_").toUpperCase();
  const data = {
    code: `E2E_${codeSuffix}`,
    name: "E2E Promotion",
    benefitType: "ORDER_FIXED_DISCOUNT",
    discountMinor: 100,
    minimumMinor: 500,
    startsAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const allowed = await adminPage.request.post("/api/admin/promotions", {
    data,
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  const allowedBody = await allowed.json();
  expect(allowedBody, JSON.stringify(allowedBody)).toMatchObject({
    ok: true,
    value: { code: data.code },
  });
  const denied = await deniedAdminPage.request.post("/api/admin/promotions", {
    data: { ...data, code: `DENIED_${codeSuffix}` },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});
