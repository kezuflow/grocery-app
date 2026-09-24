import { test, expect } from "./admin-authenticated-fixture";

test("desktop pickup contact keeps the original save after a lost response", async ({
  adminPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/admin/locations/location-cebu-central/pickup");
  await expect(page.getByText("Pickup location from step 1")).toBeVisible();
  const sender = `Pickup contact ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByRole("textbox", { name: "Sender name", exact: true }).fill(sender);
  await page
    .getByRole("textbox", { name: "Sender phone (+63…)", exact: true })
    .fill("+639171110000");

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

  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("button", { name: "Retry saving" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Sender name", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry saving" }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);

  await page.goto("/admin/locations/location-cebu-central/pickup");
  await expect(page.getByRole("textbox", { name: "Sender name", exact: true })).toHaveValue(sender);
  await page.screenshot({
    path: testInfo.outputPath("pickup-profile-recovered.png"),
    fullPage: true,
  });
});
