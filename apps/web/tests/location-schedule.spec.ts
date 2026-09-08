import { test, expect } from "./admin-authenticated-fixture";
for (const width of [1440, 390]) {
  test(`Global configures weekly hours and a closure with response recovery at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/admin/locations");
    await page.getByRole("link", { name: "Operating hours for Central Cebu", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Central Cebu operating hours" })).toBeVisible();
    while (await page.getByRole("button", { name: /Remove interval/ }).count())
      await page
        .getByRole("button", { name: /Remove interval/ })
        .first()
        .click();
    while (await page.getByRole("button", { name: /Remove closure/ }).count())
      await page
        .getByRole("button", { name: /Remove closure/ })
        .first()
        .click();
    await page.getByRole("button", { name: "Add operating interval" }).click();
    await page.getByRole("combobox", { name: "Day 1" }).click();
    await page.getByRole("option", { name: "Monday", exact: true }).click();
    await page.getByLabel("Interval 1 opens", { exact: true }).fill("08:00");
    await page.getByLabel("Interval 1 closes", { exact: true }).fill("18:00");
    await page.getByRole("button", { name: "Add closure", exact: true }).click();
    const local = (hours: number) => {
      const date = new Date(Date.now() + hours * 3600000);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    await page.getByLabel("Closure 1 startsAt", { exact: true }).fill(local(24));
    await page.getByLabel("Closure 1 endsAt", { exact: true }).fill(local(26));
    await page.getByLabel("Closure 1 reason", { exact: true }).fill("Planned maintenance");
    await page
      .getByLabel("Reason for schedule change", { exact: true })
      .fill("Review weekly operation");
    const attempts: { key: string | undefined; body: string | null }[] = [];
    await page.route("**/api/admin/location-schedule", async (route) => {
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
    await page.getByRole("button", { name: "Save operating schedule" }).click();
    await expect(page.getByLabel("Interval 1 opens", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Retry unconfirmed schedule" }).click();
    await expect(page.getByRole("status")).toContainText("Operating schedule saved");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await page.reload();
    await expect(page.getByLabel("Interval 1 opens", { exact: true })).toHaveValue("08:00");
    await expect(page.getByLabel("Closure 1 reason", { exact: true })).toHaveValue(
      "Planned maintenance",
    );
    await page.screenshot({ path: testInfo.outputPath("operating-schedule.png"), fullPage: true });
  });
}
