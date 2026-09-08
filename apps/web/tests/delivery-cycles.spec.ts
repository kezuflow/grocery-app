import { test, expect } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`operator creates and schedules delivery windows with response recovery at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/admin/settings/delivery-cycles");
    const scope = page.getByRole("combobox", { name: "Active admin scope" });
    if (await scope.evaluate((element) => element.tagName === "SELECT"))
      await scope.selectOption({ label: "Global" });
    else {
      await scope.click();
      await page.getByRole("option", { name: "Global", exact: true }).click();
    }
    await page.getByRole("button", { name: "New cycle", exact: true }).click();
    const name = `Weekly delivery ${width} ${Date.now()}`;
    await page.getByLabel("Cycle name", { exact: true }).fill(name);
    const now = Date.now();
    const local = (hours: number) => {
      const date = new Date(now + hours * 3600000);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    for (const [label, hours] of [
      ["Orders open", 1],
      ["Order cutoff", 24],
      ["Procurement starts", 25],
      ["Preparation starts", 28],
      ["Planned courier pickup", 30],
    ] as const)
      await page.getByLabel(label, { exact: true }).fill(local(hours));
    await page.getByLabel("Window 1 name", { exact: true }).fill("Morning");
    await page.getByLabel("Window 1 starts", { exact: true }).fill(local(31));
    await page.getByLabel("Window 1 ends", { exact: true }).fill(local(33));
    await page.getByRole("button", { name: "Add delivery window" }).click();
    await page.getByLabel("Window 2 name", { exact: true }).fill("Afternoon");
    await page.getByLabel("Window 2 starts", { exact: true }).fill(local(34));
    await page.getByLabel("Window 2 ends", { exact: true }).fill(local(36));
    await page
      .getByRole("checkbox", { name: /Central Cebu/ })
      .first()
      .check();
    await page.getByLabel("Reason", { exact: true }).fill("Prepare weekly service");
    const attempts: { key: string | undefined; body: string | null }[] = [];
    await page.route("**/api/admin/delivery-cycles", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (attempts.length === 1 || attempts.length === 3 || attempts.length === 5)
        await route.abort("failed");
      else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByLabel("Cycle name", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Retry unconfirmed request" }).click();
    const cycle = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(cycle).toContainText("DRAFT");
    await cycle
      .getByLabel(`Scheduling reason for ${name}`)
      .fill("Reviewed procurement and customer windows");
    await cycle.getByRole("button", { name: `Schedule ${name}`, exact: true }).click();
    await page.getByRole("button", { name: "Retry unconfirmed request" }).click();
    await expect(cycle).toContainText("SCHEDULED");
    await expect(cycle).toContainText("Morning");
    await expect(cycle).toContainText("Afternoon");
    expect(attempts).toHaveLength(4);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[3]).toEqual(attempts[2]);
    await page.reload();
    await expect(cycle).toContainText("SCHEDULED");
    await expect(cycle.getByRole("button", { name: `Edit ${name}` })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("scheduled-cycle.png"), fullPage: true });
    await cycle.getByText("Cancel unpaid cycle", { exact: true }).click();
    await cycle.getByLabel(`Cancellation reason for ${name}`).fill("Replace unused schedule");
    await cycle.getByRole("button", { name: `Cancel ${name}`, exact: true }).click();
    await page.getByRole("button", { name: "Retry unconfirmed request" }).click();
    await expect(cycle).toContainText("CANCELED");
    expect(attempts).toHaveLength(6);
    expect(attempts[5]).toEqual(attempts[4]);
    await page.reload();
    await expect(cycle).toContainText("CANCELED");
    await page.screenshot({ path: testInfo.outputPath("canceled-cycle.png"), fullPage: true });
  });
}
