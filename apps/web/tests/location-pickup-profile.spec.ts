import { test, expect } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`pickup profile retains the original save after a lost response at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/admin/delivery");
    const scope = page.getByRole("combobox", { name: "Active admin scope" });
    if (await scope.evaluate((element) => element.tagName === "SELECT")) {
      await scope.selectOption({ label: "Central Cebu" });
    } else {
      await scope.click();
      await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    }
    await page.getByText("Store courier pickup profile", { exact: true }).click();
    const sender = `Pickup contact ${width}`;
    for (const [label, value] of [
      ["Sender name", sender],
      ["Sender phone (+63…)", "+639171110000"],
      ["Full pickup address", "Receiving entrance, Cebu"],
      ["Address line 1", "Receiving entrance"],
      ["City", "Cebu"],
    ])
      await page.getByRole("textbox", { name: label, exact: true }).fill(value);
    const attempts: { key: string | undefined; body: string | null }[] = [];
    await page.route("**/api/admin/delivery-location-profile", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      attempts.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (attempts.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: /^(Save|Update) pickup profile$/ }).click();
    await expect(page.getByRole("textbox", { name: "Sender name", exact: true })).toBeDisabled();
    if (width === 390) {
      if (await scope.evaluate((element) => element.tagName === "SELECT"))
        await scope.selectOption({ label: "Global" });
      else {
        await scope.click();
        await page.getByRole("option", { name: "Global", exact: true }).click();
      }
      await expect(page.getByRole("textbox", { name: "Sender name", exact: true })).toBeDisabled();
    }
    await page.getByRole("button", { name: "Retry unconfirmed save" }).click();
    await expect(page.getByRole("button", { name: "Retry unconfirmed save" })).not.toBeVisible();
    if (width === 390) {
      if (await scope.evaluate((element) => element.tagName === "SELECT"))
        await scope.selectOption({ label: "Central Cebu" });
      else {
        await scope.click();
        await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
      }
      await page.getByText("Store courier pickup profile", { exact: true }).click();
    }
    await expect(page.getByRole("textbox", { name: "Sender name", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Sender name", exact: true })).toHaveValue(
      sender,
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await page.reload();
    await page.getByText("Store courier pickup profile", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Sender name", exact: true })).toHaveValue(
      sender,
    );
    await page.screenshot({
      path: testInfo.outputPath("pickup-profile-recovered.png"),
      fullPage: true,
    });
  });
}
