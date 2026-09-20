import { test, expect } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`operator plans, activates and deactivates one connected cycle with response recovery at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/admin/settings/scheduled-cycles");
    const scope = page.getByRole("combobox", { name: "Active admin scope" });
    if (await scope.evaluate((element) => element.tagName === "SELECT"))
      await scope.selectOption({ label: "Global" });
    else {
      await scope.click();
      await page.getByRole("option", { name: "Global", exact: true }).click();
    }

    await expect(page.getByRole("region", { name: "Scheduled cycle calendar" })).toBeVisible();
    if (width === 390)
      await expect(page.getByRole("button", { name: "agenda", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    await page.getByRole("button", { name: "New cycle", exact: true }).click();
    const editor =
      width >= 1280
        ? page.getByRole("complementary", { name: "Cycle workspace panel" })
        : page.getByRole("dialog");
    await expect(editor.getByRole("heading", { name: "New cycle" })).toBeVisible();

    const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const deliveryDay = String(deliveryDate.getDate());
    await editor.getByRole("button", { name: "Customer delivery date" }).click();
    await page
      .locator('[data-slot="calendar"] button[data-day]')
      .filter({ hasText: new RegExp(`^${deliveryDay}$`) })
      .click();
    await editor.getByLabel("Arrival starts", { exact: true }).fill("09:00");
    await editor.getByLabel("Arrival ends", { exact: true }).fill("12:00");
    const name = `Weekly delivery ${width} ${Date.now()}`;
    await editor.getByLabel("Cycle name", { exact: true }).fill(name);
    await editor.getByRole("checkbox", { name: "Central Cebu", exact: true }).check();
    await editor.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(editor.getByRole("heading", { name: "Build the schedule" })).toBeVisible();
    await expect(editor.getByLabel("Orders open time", { exact: true })).not.toHaveValue("");
    await editor.getByRole("button", { name: "Continue", exact: true }).click();
    await editor.getByLabel("Planning note", { exact: true }).fill("Prepare weekly service");
    await page.screenshot({
      path: testInfo.outputPath("scheduled-cycle-review.png"),
      fullPage: true,
    });

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

    await editor.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(editor.getByLabel("Planning note", { exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "Retry unconfirmed request" }).click();
    const details =
      width >= 1280
        ? page.getByRole("complementary", { name: "Cycle workspace panel" })
        : page.getByRole("dialog");
    await expect(details.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(details).toContainText("Draft");
    await expect(details).toContainText("Customer delivery");
    await expect(details).toContainText("Central Cebu");

    await details.getByRole("button", { name: "Activate cycle", exact: true }).click();
    const activate = page.getByRole("alertdialog");
    await expect(activate).toContainText("locks the schedule for editing");
    await activate.getByRole("button", { name: "Activate cycle", exact: true }).click();
    await details.getByRole("button", { name: "Retry unconfirmed request" }).click();
    await expect(details).toContainText("Scheduled");
    await expect(details.getByRole("button", { name: "Edit draft" })).toHaveCount(0);
    expect(attempts).toHaveLength(4);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[3]).toEqual(attempts[2]);
    await page.screenshot({ path: testInfo.outputPath("scheduled-cycle.png"), fullPage: true });

    await details.getByRole("button", { name: "Deactivate", exact: true }).click();
    const deactivate = page.getByRole("alertdialog");
    await expect(deactivate).toContainText(name);
    await expect(deactivate).toContainText("closes unstarted checkout quotes");
    await deactivate.getByRole("button", { name: "Deactivate cycle", exact: true }).click();
    await details.getByRole("button", { name: "Retry unconfirmed request" }).click();
    await expect(details).toContainText("Canceled");
    expect(attempts).toHaveLength(6);
    expect(attempts[5]).toEqual(attempts[4]);
    await page.screenshot({ path: testInfo.outputPath("canceled-cycle.png"), fullPage: true });
  });
}
