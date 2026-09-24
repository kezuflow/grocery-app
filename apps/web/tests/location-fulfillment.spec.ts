import { test, expect } from "./admin-authenticated-fixture";
for (const width of [1440, 390]) {
  test(`Global saves fulfillment readiness with response recovery at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/admin/locations");
    await page
      .getByRole("link", { name: "Fulfillment readiness for Central Cebu", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Review Central Cebu" })).toBeVisible();
    const readiness = page.getByRole("checkbox", { name: "Ready to dispatch customer orders" });
    const nextReady = !(await readiness.isChecked());
    if (nextReady) await readiness.check();
    else await readiness.uncheck();
    const promise = String(80 + Math.floor(Math.random() * 20));
    await page.getByLabel("Instant delivery promise (minutes)", { exact: true }).fill(promise);
    await page
      .getByLabel("Reason for change (required)", { exact: true })
      .fill("Review staffed dispatch readiness");
    const attempts: { key: string | undefined; body: string | null }[] = [];
    await page.route("**/api/admin/location-fulfillment", async (route) => {
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
    await page.getByRole("button", { name: "Save fulfillment settings", exact: true }).click();
    const saveStatus = page.locator('p[role="status"][aria-live="polite"]');
    await expect(saveStatus).toContainText("Save awaiting confirmation");
    await expect(
      page.getByLabel("Instant delivery promise (minutes)", { exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Retry saving" }).click();
    await expect(saveStatus).toContainText("No unsaved changes");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await page.reload();
    await expect(
      page.getByLabel("Instant delivery promise (minutes)", { exact: true }),
    ).toHaveValue(promise);
    await expect(readiness).toHaveAttribute("aria-checked", String(nextReady));
    await page.screenshot({
      path: testInfo.outputPath("fulfillment-readiness.png"),
      fullPage: true,
    });
  });
}
