import { test, expect } from "./admin-authenticated-fixture";
for (const width of [1440, 390]) {
  test(`Global configures weekly hours and a closure with response recovery at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/admin/locations");
    await page
      .getByRole("link", { name: "Instant operating hours for Central Cebu", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Central Cebu Instant operating hours" }),
    ).toBeVisible();
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
    await page.getByRole("combobox", { name: "Interval 1 opens hour", exact: true }).click();
    await page.getByRole("option", { name: "8", exact: true }).click();
    await page.getByRole("combobox", { name: "Interval 1 closes hour", exact: true }).click();
    await page.getByRole("option", { name: "6", exact: true }).click();
    await page.getByRole("button", { name: "Add closure", exact: true }).click();
    const local = (hours: number) => {
      const date = new Date(Date.now() + hours * 3600000);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    for (const [field, value] of [
      ["startsAt", local(24)],
      ["endsAt", local(26)],
    ]) {
      await page.getByLabel(`Closure 1 ${field} date`, { exact: true }).fill(value.slice(0, 10));
      const hour = Number(value.slice(11, 13));
      await page.getByRole("combobox", { name: `Closure 1 ${field} hour`, exact: true }).click();
      await page.getByRole("option", { name: String(hour % 12 || 12), exact: true }).click();
      await page.getByRole("combobox", { name: `Closure 1 ${field} minute`, exact: true }).click();
      await page.getByRole("option", { name: value.slice(14, 16), exact: true }).click();
      await page
        .getByRole("combobox", { name: `Closure 1 ${field} AM or PM`, exact: true })
        .click();
      await page.getByRole("option", { name: hour >= 12 ? "PM" : "AM", exact: true }).click();
    }
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
    await page.getByRole("button", { name: "Save and continue", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Interval 1 opens hour", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Retry unconfirmed schedule" }).click();
    await expect(page).toHaveURL(/\/admin\/locations\/[^/]+\/fulfillment$/);
    await expect(page.getByRole("heading", { name: "Review Central Cebu" })).toBeVisible();
    expect(JSON.parse(attempts[0].body!).schedule.weekly[0]).toMatchObject({
      opensMinute: 480,
      closesMinute: 1080,
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await page.getByRole("link", { name: "Review hours", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Interval 1 opens hour", exact: true }),
    ).toHaveText("8");
    await expect(page.getByLabel("Closure 1 reason", { exact: true })).toHaveValue(
      "Planned maintenance",
    );
    await page.screenshot({ path: testInfo.outputPath("operating-schedule.png"), fullPage: true });
  });
}
