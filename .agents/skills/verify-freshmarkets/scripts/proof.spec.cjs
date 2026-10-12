const { test, expect } = require("../../../../apps/web/node_modules/@playwright/test");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");

test("catalog search through the customer search field", async ({ page }, testInfo) => {
  const { doctor } = await import("./doctor.mjs");
  const health = await doctor(process.env.FM_VERIFY_RUN_FILE);
  await writeFile(
    path.join(process.env.FM_VERIFY_EVIDENCE, "doctor.json"),
    JSON.stringify(health, null, 2),
  );
  const actions = [];
  const capture = async (name) => {
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    await writeFile(
      testInfo.outputPath(`${name}.aria.txt`),
      await page.locator("body").ariaSnapshot(),
    );
  };
  await test.step("Open storefront and dismiss welcome announcement", async () => {
    actions.push({ action: "goto", target: "/" });
    await page.goto("/");
    const welcome = page.getByRole("dialog", { name: "FreshMarkets welcome" });
    await expect(welcome).toBeVisible();
    await capture("before-search");
    await page.getByRole("button", { name: "Close welcome announcement", exact: true }).click();
  });
  const search = page.locator('input[name="q"]:visible');
  await expect(search).toHaveCount(1);
  await test.step("Search for strawberry with the visible form", async () => {
    actions.push({ action: "fill-and-enter", target: "Search groceries", value: "strawberry" });
    await search.fill("strawberry");
    await search.press("Enter");
    await expect(page).toHaveURL(/q=strawberry/);
    await expect(page.getByRole("heading", { name: "Baguio Strawberries" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Native Garlic" })).toHaveCount(0);
    await capture("matching-results");
  });
  await test.step("Search for an absent grocery and observe recovery", async () => {
    actions.push({ action: "fill-and-enter", target: "Search groceries", value: "zzznothing" });
    await search.fill("zzznothing");
    await search.press("Enter");
    await expect(page).toHaveURL(/q=zzznothing/);
    await expect(page.getByRole("heading", { name: "No groceries found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Baguio Strawberries" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Browse all groceries" })).toBeVisible();
    await capture("empty-results");
  });
  await writeFile(
    testInfo.outputPath("actions.json"),
    JSON.stringify(
      {
        feature: "catalog-search",
        entryPoint: "visible Search groceries form",
        actions,
        result: "Match and empty result states observed; no commerce writes",
      },
      null,
      2,
    ),
  );
});
