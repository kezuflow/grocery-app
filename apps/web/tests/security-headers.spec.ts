import { expect, test } from "@playwright/test";

test("deployed pages hydrate under a request-nonce CSP", async ({ page }) => {
  const policyViolations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      policyViolations.push(message.text());
    }
  });

  const response = await page.goto("/auth/login", { waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  const policy = response?.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/script-src 'self' 'nonce-([a-f0-9]{32})'/)?.[1];

  expect(nonce).toBeTruthy();
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();

  const inlineScriptNonces = await page
    .locator("script:not([src])")
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(inlineScriptNonces.length).toBeGreaterThan(0);
  expect(new Set(inlineScriptNonces)).toEqual(new Set([nonce]));
  expect(policyViolations).toEqual([]);
});
