import { test, expect } from "./admin-authenticated-fixture";

test("Global pause retains its request through a lost response and scope change", async ({
  adminPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto("/admin/settings/fulfillment-mode");
  const scope = page.getByRole("combobox", { name: "Active admin scope" });
  async function selectScope(label: string) {
    if (await scope.evaluate((element) => element.tagName === "SELECT"))
      await scope.selectOption({ label });
    else {
      await scope.click();
      await page.getByRole("option", { name: label, exact: true }).click();
    }
  }
  await selectScope("Global");
  await page.getByLabel("Commerce change reason", { exact: true }).fill("Review service setup");
  const attempts: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/admin/commerce-configuration", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    const response = await route.fetch();
    expect(await response.json()).toMatchObject({ ok: true });
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Pause selling", exact: true }).click();
  await expect(page.getByLabel("Commerce change reason", { exact: true })).toBeDisabled();
  await selectScope("Central Cebu");
  await expect(
    page.getByRole("button", { name: "Retry unconfirmed commerce request" }),
  ).toBeVisible();
  await selectScope("Global");
  await page.getByRole("button", { name: "Retry unconfirmed commerce request" }).click();
  await expect(page.getByText("Selling paused.", { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Reopen selling", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("paused-commerce.png"), fullPage: true });
});
