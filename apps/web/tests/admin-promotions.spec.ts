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

test("creates, edits and activates a campaign through lost browser responses", async ({
  adminPage: page,
}, testInfo) => {
  const code = `REPLAY_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
  const requests = new Map<string, { body: string | null; key: string | undefined }[]>();
  await page.route("**/api/admin/promotions**", async (route) => {
    if (!["POST", "PATCH"].includes(route.request().method())) return route.continue();
    const path = new URL(route.request().url()).pathname;
    const sent = requests.get(path) ?? [];
    sent.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    requests.set(path, sent);
    if (sent.length > 1) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ ok: true });
    await route.abort("failed");
  });
  await page.goto("/admin/promotions");
  await page.getByLabel("Promotion code", { exact: true }).fill(code);
  await page.getByLabel("Promotion name", { exact: true }).fill("Recovery campaign");
  await page.getByLabel("Fixed discount in pesos", { exact: true }).fill("19.99");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: code, exact: true }) });
  await row.getByRole("link", { name: "Manage", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Weekend campaign");
  await page.getByLabel("Campaign discount", { exact: true }).fill("25.50");
  await page.getByLabel("Campaign minimum purchase", { exact: true }).fill("200.00");
  await page.getByRole("button", { name: "Save campaign", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Weekend campaign" })).toBeVisible();
  await page.getByLabel("Reason", { exact: true }).fill("Launch weekend campaign");
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  expect(requests.size).toBe(3);
  for (const sent of requests.values()) {
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  }
  await page.screenshot({ path: testInfo.outputPath("promotion-recovery.png"), fullPage: true });
});

for (const benefit of ["Free delivery", "Delivery percentage off", "Delivery amount off"])
  test(`authors and previews ${benefit} from Admin`, async ({ adminPage: page }, testInfo) => {
    const code = `DELIVERY_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto("/admin/promotions");
    await page.getByLabel("Promotion code", { exact: true }).fill(code);
    await page.getByLabel("Promotion name", { exact: true }).fill(benefit);
    await page.getByRole("combobox", { name: "Campaign benefit", exact: true }).click();
    await page.getByRole("option", { name: benefit, exact: true }).click();
    if (benefit !== "Free delivery")
      await page
        .getByLabel(
          benefit === "Delivery percentage off" ? "Discount percentage" : "Fixed discount in pesos",
          { exact: true },
        )
        .fill(benefit === "Delivery percentage off" ? "25" : "30.00");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: code, exact: true }) })
      .getByRole("link", { name: "Manage", exact: true })
      .click();
    await page.getByLabel("Campaign maximum discount", { exact: true }).fill("25.50");
    await page.getByLabel("Campaign total redemption limit", { exact: true }).fill("10");
    await page.getByLabel("Campaign customer redemption limit", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Save campaign", exact: true }).click();
    await expect(page.getByLabel("Campaign maximum discount", { exact: true })).toHaveValue(
      "25.50",
    );
    await page.getByLabel("Reason", { exact: true }).fill("Launch delivery campaign");
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
    await expect(page.getByText("Maximum discount: PHP 25.50", { exact: true })).toBeVisible();
    await expect(page.getByText("Total redemption limit: 10", { exact: true })).toBeVisible();
    await page.getByLabel("Subtotal in pesos", { exact: true }).fill("200.00");
    await page.getByLabel("Delivery fee in pesos", { exact: true }).fill("70.00");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: benefit === "Delivery percentage off" ? "17.50" : "25.50" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("delivery-promotion.png"), fullPage: true });
  });
