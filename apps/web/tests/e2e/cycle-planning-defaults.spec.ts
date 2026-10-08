import { test, expect, queryAdminE2eSql } from "./admin-authenticated-fixture";

function dateAfter(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function displayDate(date: string, calendar = false) {
  return new Intl.DateTimeFormat(calendar ? "en-US" : "en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: calendar ? "long" : "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00+08:00`));
}

for (const width of [1440, 390]) {
  test(`new-cycle defaults survive calendar selection, review and Core save at ${width}px`, async ({
    adminPage: page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/admin/settings/scheduled-cycles");
    const scope = page.getByRole("combobox", { name: "Active admin scope" });
    if (await scope.evaluate((element) => element.tagName === "SELECT"))
      await scope.selectOption({ label: "Global" });
    else {
      await scope.click();
      await page.getByRole("option", { name: "Global", exact: true }).click();
    }
    await page.getByRole("button", { name: "month", exact: true }).click();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    // Use the next Friday so this remains a future schedule on later runs.
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const opening = dateAfter(today, (5 - weekday + 7) % 7 || 7);
    const cutoff = dateAfter(opening, 7);
    const delivery = dateAfter(cutoff, 1);
    const end = dateAfter(delivery, 1);
    const cell = (date: string) =>
      page.getByRole("gridcell", { name: displayDate(date, true), exact: true });
    const selectedDate = width === 1440 ? cutoff : delivery;
    if (!(await cell(selectedDate).isVisible()))
      await page.getByRole("button", { name: "Next calendar period" }).click();
    await expect(cell(selectedDate)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh visible calendar range" }),
    ).toBeEnabled();
    if (width === 1440) {
      await expect(cell(cutoff)).toBeVisible();
      const first = (await cell(opening).boundingBox())!;
      const last = (await cell(cutoff).boundingBox())!;
      await page.mouse.move(first.x + first.width / 2, first.y + first.height - 8);
      await page.mouse.down();
      await page.mouse.move(last.x + last.width / 2, last.y + last.height - 8, { steps: 12 });
      await page.mouse.up();
    } else {
      const target = (await cell(delivery).boundingBox())!;
      await cell(delivery).click({ position: { x: target.width / 2, y: target.height - 8 } });
    }
    const editor =
      width === 1440
        ? page.getByRole("complementary", { name: "Cycle workspace panel" })
        : page.getByRole("dialog");
    await expect(editor.getByRole("heading", { name: "New cycle" })).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Customer delivery date", exact: true }),
    ).toHaveText(displayDate(delivery));
    await expect(editor.getByLabel("Arrival starts", { exact: true })).toHaveValue("00:00");
    await expect(editor.getByLabel("Arrival ends", { exact: true })).toHaveValue("23:59");
    const name = `Cycle defaults ${width} ${crypto.randomUUID()}`;
    await editor.getByLabel("Cycle name", { exact: true }).fill(name);
    await editor.getByRole("checkbox", { name: "Central Cebu", exact: true }).check();
    await editor.getByRole("button", { name: "Continue", exact: true }).click();
    for (const [label, date, time] of [
      ["Orders open", opening, "00:00"],
      ["Order cutoff", cutoff, "00:00"],
      ["Procurement starts", cutoff, "00:00"],
      ["Preparation starts", cutoff, "00:00"],
      ["Customer delivery starts", delivery, "00:00"],
      ["Customer delivery ends", end, "23:59"],
    ]) {
      await expect(editor.getByRole("button", { name: `${label} date`, exact: true })).toHaveText(
        displayDate(date!),
      );
      await expect(editor.getByLabel(`${label} time`, { exact: true })).toHaveValue(time!);
    }
    await page.screenshot({ path: `../../.wrangler/cycle-defaults-${width}.png`, fullPage: true });
    const deliveryEnd = editor.getByLabel("Customer delivery ends time", { exact: true });
    await deliveryEnd.scrollIntoViewIfNeeded();
    await expect(deliveryEnd).toBeVisible();
    await page.screenshot({
      path: `../../.wrangler/cycle-defaults-delivery-${width}.png`,
      fullPage: true,
    });
    await editor.getByRole("button", { name: "Continue", exact: true }).click();
    await editor
      .getByLabel("Planning note", { exact: true })
      .fill("Verify finalized cycle defaults");
    await expect(editor).toContainText(displayDate(end));
    const reply = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/delivery-cycles") &&
        response.request().method() === "POST",
    );
    await editor.getByRole("button", { name: "Save draft", exact: true }).click();
    const result = await (await reply).json();
    expect(result).toMatchObject({ ok: true, value: { name, status: "DRAFT" } });
    const at = (date: string, time = "00:00") => Date.parse(`${date}T${time}:00+08:00`);
    const saved = queryAdminE2eSql(
      `SELECT c.order_opens_at,c.cutoff_at,s.procurement_at,s.preparation_at,w.starts_at,w.ends_at FROM delivery_cycle c JOIN delivery_cycle_schedule s ON s.cycle_id=c.id JOIN delivery_cycle_window w ON w.cycle_id=c.id WHERE c.id='${result.value.cycleId.replaceAll("'", "''")}'`,
    ) as { results: unknown[] }[];
    expect(saved[0]!.results).toEqual([
      {
        order_opens_at: at(opening),
        cutoff_at: at(cutoff),
        procurement_at: at(cutoff),
        preparation_at: at(cutoff),
        starts_at: at(delivery),
        ends_at: at(end, "23:59"),
      },
    ]);
  });
}
