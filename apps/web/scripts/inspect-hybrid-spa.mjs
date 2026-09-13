import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const origin = process.env.HSPA_ORIGIN ?? "https://freshmarkets.ph";
const output = process.env.HSPA_ARTIFACT_DIR;
if (!output) throw new Error("HSPA_ARTIFACT_DIR is required");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (mobile) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
    }
    await page.addInitScript(() =>
      sessionStorage.setItem("freshmarkets.location-prompt-dismissed", "1"),
    );
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(origin, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(output, `hspa-${mobile ? "mobile" : "desktop"}.png`) });
    const images = await page.locator('img[src^="/media/banners/"]').evaluateAll((elements) =>
      elements.map((image) => ({
        src: image.currentSrc,
        width: image.naturalWidth,
        complete: image.complete,
      })),
    );
    const nav = page.getByRole("navigation", { name: "Grocery categories" });
    const category = nav.locator('a[href^="/?category="]').first();
    const href = await category.getAttribute("href");
    if (!href) throw new Error("Category missing");
    const visitCategory = async () => {
      await category.focus();
      const started = Date.now();
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (expected) => location.search === expected,
        new URL(href, origin).search,
      );
      await page.locator("#catalog article").first().waitFor();
      return Date.now() - started;
    };
    await visitCategory();
    let catalogReads = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/catalog")) catalogReads++;
    });
    const cachedRevisitsMs = [];
    for (let i = 0; i < 5; i++) {
      await nav.getByRole("link", { name: "All groceries", exact: true }).click();
      await page.waitForFunction(() => location.search === "");
      await page.locator("#catalog article").first().waitFor();
      cachedRevisitsMs.push(await visitCategory());
    }
    results.push({
      profile: mobile ? "mobile-4x-1.6mbps-150ms" : "desktop-unthrottled",
      status: response.status(),
      images,
      cachedRevisitsMs,
      catalogReads,
      errors,
    });
    await context.close();
  }
} finally {
  await writeFile(
    join(output, "hspa-inspection.json"),
    JSON.stringify({ origin, results }, null, 2),
  );
  await browser.close();
}
