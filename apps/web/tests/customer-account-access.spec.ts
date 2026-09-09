import { expect, test } from "./admin-authenticated-fixture";

test.describe.configure({ timeout: 180000 });
test.use({ actionTimeout: 15000 });
for (const width of [1440, 390]) {
  test(`customer account recovery and sign-out at ${width}px`, async ({
    signedInPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const session = await (await page.request.get("/api/auth/get-session")).json();
    await page.goto("/account");
    await expect(
      page.getByRole("link", { name: "Contact FreshMarkets", exact: true }),
    ).toHaveAttribute("href", "mailto:support@freshmarkets.ph");
    await expect(
      page.getByRole("link", { name: "Request account closure", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`ca78-account-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("link", { name: "Reset your password", exact: true }).click();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(session.user.email);
    let resetRequests = 0;
    await page.route("**/api/auth/request-password-reset", async (route) => {
      if (++resetRequests === 1) await route.abort();
      else await route.continue();
    });
    await page.getByRole("button", { name: "Send reset instructions", exact: true }).click();
    await expect(
      page.getByText("Your request could not be confirmed. Please try again.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Send reset instructions", exact: true }).click();
    await expect(page.getByText("Reset instructions requested.", { exact: true })).toBeVisible();
    await page.goto("/auth/reset-password?token=deliberately-invalid-test-token");
    await page.getByLabel("New password", { exact: true }).fill("test-invalid-token-password");
    await page.getByRole("button", { name: "Update password", exact: true }).click();
    await expect(
      page.getByText("Reset link is invalid or expired. Request a new link.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request a new reset link", exact: true }),
    ).toHaveAttribute("href", "/auth/forgot-password");
    await page.goto("/account");
    await page.getByRole("link", { name: "Sign out", exact: true }).click();
    let signOuts = 0;
    await page.route("**/api/auth/sign-out", async (route) => {
      if (++signOuts === 1) await route.abort();
      else await route.continue();
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByText("Sign out could not be confirmed. Please try again.", { exact: true }),
    ).toBeVisible();
    expect((await (await page.request.get("/api/auth/get-session")).json()).session).toBeTruthy();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByText("You are signed out.", { exact: true })).toBeVisible();
    expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
    expect(await (await page.request.get("/api/commerce/profile")).json()).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
}
