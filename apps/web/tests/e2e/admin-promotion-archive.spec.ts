import { expect, test } from "./admin-authenticated-fixture";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`archives a promotion code from its list row at ${viewport.width}px`, async ({
    adminPage: page,
  }) => {
    await page.setViewportSize(viewport);
    const code = `ARCHIVE_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
    const created = await page.request.post("/api/admin/promotions", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        code,
        name: "Archive code",
        description: "",
        benefitType: "ORDER_FIXED_DISCOUNT",
        discountMinor: 1000,
        minimumMinor: 0,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    const creation = await created.json();
    expect(creation).toMatchObject({ ok: true, value: { status: "DRAFT", version: 1 } });
    const id = creation.value.promotionId;
    const statusUrl = `/api/admin/promotions/${id}/status`;
    await page.goto(`/admin/promotions?query=${code}`);
    const row = page
      .getByRole("row", { includeHidden: true })
      .filter({ has: page.getByRole("cell", { name: code, exact: true, includeHidden: true }) });
    const archive = row.getByRole("button", { name: `Archive ${code}`, exact: true });
    await expect(archive).toBeEnabled();

    // Exercise the existing active -> inactive prerequisite on the mobile journey.
    let version = 1;
    if (viewport.width === 390) {
      await row.getByRole("switch").click();
      await expect(row.locator("[data-promotion-status-text]")).toHaveText("Active");
      await expect(archive).toBeDisabled();
      await expect(archive).toHaveAttribute("title", "Deactivate this code before archiving");
      await row.getByRole("switch").click();
      await expect(row.locator("[data-promotion-status-text]")).toHaveText("Inactive");
      await expect(archive).toBeEnabled();
      version = 3;
    }

    await archive.click();
    const dialog = page.getByRole("alertdialog", { name: "Archive promotion code?" });
    await expect(dialog).toContainText(code);
    await expect(dialog).toContainText("Archiving cannot be undone");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../.wrangler/promotion-archive-dialog-${viewport.width}.png`,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(archive).toBeFocused();
    expect(await (await page.request.get(`/api/admin/promotions/${id}`)).json()).toMatchObject({
      ok: true,
      value: { version, status: viewport.width === 390 ? "INACTIVE" : "DRAFT" },
    });

    const writes: Array<{ body: string | null; key: string | undefined }> = [];
    await page.route(`**${statusUrl}`, async (route) => {
      writes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true, value: { status: "ARCHIVED" } });
      // Core commits once, but both the initial response and automatic retry are lost.
      if (writes.length <= 2) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await archive.click();
    await dialog.getByRole("button", { name: "Confirm archive", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Archiving could not be confirmed");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await expect(row.locator("[data-promotion-status-text]")).not.toHaveText("Archived");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Retry archive", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator("[data-promotion-status-text]")).toHaveText("Archived");
    expect(writes).toHaveLength(3);
    expect(writes[0].key).toBeTruthy();
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[2]).toEqual(writes[0]);
    expect(JSON.parse(writes[0].body!)).toEqual({ action: "ARCHIVE", expectedVersion: version });
    await expect(archive).toHaveCount(0);
    await expect(row.getByRole("switch")).toHaveCount(0);
    await row.getByRole("button", { name: `Open actions for ${code}`, exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Edit details", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(row.locator("[data-promotion-status-text]")).toHaveText("Archived");
    expect(await (await page.request.get(`/api/admin/promotions/${id}`)).json()).toMatchObject({
      ok: true,
      value: { status: "ARCHIVED", version: version + 1, code },
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../.wrangler/promotion-archive-${viewport.width}.png`,
      animations: "disabled",
    });
  });
}

test("promotion readers have no archive action", async ({
  adminPage: manager,
  promotionsReadOnlyPage: page,
}) => {
  const code = `READER_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
  const created = await manager.request.post("/api/admin/promotions", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      code,
      name: "Reader code",
      description: "",
      benefitType: "ORDER_FIXED_DISCOUNT",
      discountMinor: 1000,
      minimumMinor: 0,
      startsAt: new Date().toISOString(),
    },
  });
  const creation = await created.json();
  expect(creation).toMatchObject({ ok: true, value: { status: "DRAFT", version: 1 } });
  await page.goto(`/admin/promotions?query=${code}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Promotion Codes", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: code, exact: true }) })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Archive / })).toHaveCount(0);
  const denied = await page.request.post(
    `/api/admin/promotions/${creation.value.promotionId}/status`,
    {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { action: "ARCHIVE", expectedVersion: 1 },
    },
  );
  expect(await denied.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  expect(
    await (await manager.request.get(`/api/admin/promotions/${creation.value.promotionId}`)).json(),
  ).toMatchObject({ ok: true, value: { status: "DRAFT", version: 1 } });
});
