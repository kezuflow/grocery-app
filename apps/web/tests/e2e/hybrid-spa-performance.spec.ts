import { writeFile } from "node:fs/promises";
import { test, expect } from "./admin-authenticated-fixture";

test("matched localhost authenticated catalog and Admin samples", async ({
  signedInPage,
  adminPage,
}) => {
  test.setTimeout(180_000);
  const output = process.env.HSPA_LOCAL_METRICS;
  test.skip(!output, "HSPA_LOCAL_METRICS enables this explicit lab run");
  if (!output) return;
  const samples = [];
  for (const [profile, page] of [
    ["authenticated-catalog", signedInPage],
    ["authenticated-admin", adminPage],
  ] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    for (let sample = 1; sample <= 5; sample++) {
      await page.goto(profile === "authenticated-catalog" ? "/" : "/admin/catalog/products");
      if (profile === "authenticated-catalog")
        await expect(page.locator("#catalog article").first()).toBeVisible();
      else await expect(page.getByRole("table", { name: "Products" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const entry = await page.evaluate(() => {
        const navigation = performance.getEntriesByType(
          "navigation",
        )[0] as PerformanceNavigationTiming;
        return {
          ttfb: navigation.responseStart,
          fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        };
      });
      const origin = await page.evaluate(() => performance.timeOrigin);
      let start: number;
      if (profile === "authenticated-catalog") {
        const link = page
          .getByRole("navigation", { name: "Grocery categories" })
          .getByRole("link", { name: "Fruits", exact: true });
        await link.focus();
        start = Date.now();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/category=fruits/);
        await expect(page.locator("#catalog article").first()).toBeVisible();
      } else {
        start = Date.now();
        await page.locator('tbody button[aria-controls="product-detail-panel"]').first().click();
        await expect(
          page.locator("#product-detail-panel").getByRole("link", { name: "Edit", exact: true }),
        ).toBeVisible();
      }
      samples.push({
        profile,
        sample,
        entry,
        usefulMs: Date.now() - start,
        documentPreserved: origin === (await page.evaluate(() => performance.timeOrigin)),
      });
    }
  }
  await writeFile(output, JSON.stringify({ environment: "isolated-localhost", samples }, null, 2));
});
