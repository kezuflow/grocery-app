import { expect, test, executeAdminE2eSql } from "./admin-authenticated-fixture";

// Run first in the single-worker managed suite: later Admin fixtures create
// Global staff and must make first-installation enrollment unavailable.

test("first administrator reviews access, recovers a lost response and opens staff administration", async ({
  page,
  signedInPage,
}, testInfo) => {
  await signedInPage.goto("/setup");
  await expect(signedInPage.getByRole("status")).toContainText(
    "Initial setup is unavailable for this account",
  );
  const denied = await signedInPage.request.post("/api/setup", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { expectedVersion: 0 },
  });
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Browser origin missing");
  const email = "initial-admin-e2e@example.com";
  const password = "correct-horse-battery-staple";
  const signedUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL },
    data: { name: "Initial administrator", email, password },
  });
  expect(signedUp.status()).toBeLessThan(400);
  // Only email delivery is a fixture. No Staff identity, role or grant is seeded.
  executeAdminE2eSql(
    "UPDATE user SET email_verified=1 WHERE email='initial-admin-e2e@example.com'",
  );
  const signedIn = await page.request.post("/api/auth/sign-in/email", {
    headers: { origin: baseURL },
    data: { email, password },
  });
  expect(signedIn.status()).toBeLessThan(400);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Create your Global access" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`initial-setup-${width}.png`),
      fullPage: true,
    });
  }
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/setup", async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    const response = await route.fetch();
    expect(await response.json()).toMatchObject({ ok: true });
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Create Global administrator access" }).click();
  await expect(page.getByRole("status")).toContainText("Setup could not be confirmed");
  await page.getByRole("button", { name: "Create Global administrator access" }).click();
  await expect(page.getByRole("status")).toContainText("Global administrator access is ready");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]?.key).toBeTruthy();
  await page.reload();
  await expect(page.getByText("Your initial administrator setup is complete.")).toBeVisible();
  await page.goto("/admin/staff");
  await expect(page.getByRole("heading", { level: 1, name: "Staff & Access" })).toBeVisible();
  await expect(page.getByText("Initial administrator", { exact: true }).first()).toBeVisible();
});
