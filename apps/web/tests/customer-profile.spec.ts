import { expect, test } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`customer preferences persist after a lost response at ${width}px`, async ({
    signedInPage,
  }, testInfo) => {
    await signedInPage.setViewportSize({ width, height: 900 });
    await signedInPage.goto("/account/profile");
    await expect(signedInPage.getByRole("heading", { name: "Your preferences" })).toBeVisible();
    await expect(
      signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }),
    ).not.toBeChecked();
    await signedInPage.getByRole("textbox", { name: "Preferred language" }).fill("Cebuano");
    await signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }).check();
    const requests: { key: string | undefined; body: string | null }[] = [];
    await signedInPage.route("**/api/commerce/profile", async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await signedInPage.getByRole("button", { name: "Save preferences", exact: true }).click();
    await expect(signedInPage.getByRole("textbox", { name: "Preferred language" })).toBeDisabled();
    await signedInPage.getByRole("button", { name: "Retry saving preferences" }).click();
    await expect(signedInPage.getByRole("status")).toContainText("Preferences saved");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await signedInPage.reload();
    await expect(signedInPage.getByRole("textbox", { name: "Preferred language" })).toHaveValue(
      "Cebuano",
    );
    await expect(
      signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }),
    ).toBeChecked();
    await signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }).uncheck();
    await signedInPage.getByRole("button", { name: "Save preferences", exact: true }).click();
    await expect(signedInPage.getByRole("status")).toContainText("Preferences saved");
    await signedInPage.reload();
    await expect(
      signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }),
    ).not.toBeChecked();
    expect(
      await signedInPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await signedInPage.screenshot({
      path: testInfo.outputPath("customer-preferences.png"),
      fullPage: true,
    });
  });
}
