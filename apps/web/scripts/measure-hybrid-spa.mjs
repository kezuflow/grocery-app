import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const origin = process.env.HSPA_ORIGIN ?? "https://freshmarkets.ph";
const output = process.env.HSPA_OUTPUT;
if (!output) throw new Error("HSPA_OUTPUT is required");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const samples =
  process.env.HSPA_RESUME === "1" ? JSON.parse(await readFile(output, "utf8")).samples : [];
try {
  for (const mobile of [false, true]) {
    for (
      let sample = samples.filter(
        (s) => s.profile === (mobile ? "mobile-4x-1.6mbps-150ms" : "desktop-unthrottled"),
      ).length;
      sample < 5;
      sample++
    ) {
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
      await page.addInitScript(() => {
        sessionStorage.setItem("freshmarkets.location-prompt-dismissed", "1");
        window.hspaMetrics = { lcp: 0, cls: 0, longTasks: 0 };
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.hspaMetrics.lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries())
            if (!e.hadRecentInput) window.hspaMetrics.cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          window.hspaMetrics.longTasks += list.getEntries().length;
        }).observe({ type: "longtask", buffered: true });
      });
      await page.goto(origin, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(2000);
      const entry = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return {
          ...window.hspaMetrics,
          ttfb: n.responseStart,
          fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
          bytes: performance
            .getEntriesByType("resource")
            .reduce((sum, e) => sum + e.transferSize, n.transferSize),
          userAgent: navigator.userAgent,
        };
      });
      const link = page
        .locator('a[href^="/?category="]:not([href="/?category=all"])')
        .filter({ hasNotText: "View all" })
        .first();
      const href = await link.getAttribute("href");
      if (!href) throw new Error("Category missing");
      const before = await page.evaluate(() => {
        window.hspaHeader = document.querySelector("header");
        return performance.timeOrigin;
      });
      let documents = 0,
        rsc = 0,
        json = 0;
      page.on("request", (request) => {
        if (request.resourceType() === "document") documents++;
        if (request.url().includes("_rsc")) rsc++;
        if (request.url().includes("/api/catalog")) json++;
      });
      await link.focus();
      await page.waitForFunction(() =>
        document.activeElement?.getAttribute("href")?.startsWith("/?category="),
      );
      const start = Date.now();
      await page.keyboard.press("Enter");
      try {
        await page.waitForFunction(
          (expected) => location.pathname + location.search === expected,
          href,
          { timeout: 30000 },
        );
      } catch (error) {
        console.log(
          JSON.stringify({ invalidNavigation: true, actualUrl: page.url(), expected: href }),
        );
        throw error;
      }
      await page.locator("#catalog h2").waitFor({ timeout: 30000 });
      const feedbackMs = Date.now() - start;
      await page.locator("#catalog article").first().waitFor({ timeout: 30000 });
      const usefulMs = Date.now() - start;
      const navigation = await page.evaluate(() => ({
        timeOrigin: performance.timeOrigin,
        shellPreserved: window.hspaHeader === document.querySelector("header"),
      }));
      samples.push({
        profile: mobile ? "mobile-4x-1.6mbps-150ms" : "desktop-unthrottled",
        sample: sample + 1,
        entry,
        navigation: {
          feedbackMs,
          usefulMs,
          documents,
          rsc,
          json,
          documentPreserved: before === navigation.timeOrigin,
          shellPreserved: navigation.shellPreserved,
        },
      });
      console.log(JSON.stringify(samples.at(-1)));
      await context.close();
    }
  }
} finally {
  await writeFile(
    output,
    JSON.stringify({ origin, measuredAt: new Date().toISOString(), samples }, null, 2),
  );
  await browser.close();
}
