import { expect, test } from "@playwright/test";

test("welcome announcement opens on every home visit with the scheduled delivery message", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Welcome to FreshMarkets" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Order cutoff is Thursday for delivery on Friday. Stay tuned for updates on instant delivery.",
  );
  const highlights = dialog.locator(".fm-announcement-emphasis");
  await expect(highlights).toHaveText(["Thursday", "Friday"]);
  for (const highlight of await highlights.all()) {
    expect(await highlight.evaluate((element) => getComputedStyle(element).color)).toBe(
      "rgb(217, 45, 32)",
    );
    expect(await highlight.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("700");
  }
  await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  await expect(dialog).toContainText("1 of 2");
  const scene = dialog.locator("img.fm-announcement-scene");
  await expect(scene).toBeVisible();
  await expect
    .poll(() => scene.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(dialog.locator('img[src="/announcements/grass-mascot.png"]')).toHaveCount(0);
  const closeBounds = await dialog
    .getByRole("button", { name: "Close welcome announcement" })
    .boundingBox();
  const brandBounds = await dialog.locator(".fm-announcement-brand").boundingBox();
  expect(closeBounds!.x).toBeGreaterThanOrEqual(brandBounds!.x + brandBounds!.width);
  const imageBounds = await scene.boundingBox();
  const visualBounds = await dialog.locator(".fm-announcement-media").boundingBox();
  expect(imageBounds!.height).toBeLessThanOrEqual(visualBounds!.height + 1);
  await page.screenshot({ path: test.info().outputPath("popup-schedule-desktop.png") });

  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  const addressDialog = page.getByRole("dialog", { name: "Set your delivery address" });
  await expect(addressDialog).toContainText(
    "Make sure to set your delivery address to use the app and place an order. Tap Deliver to at the top to get started.",
  );
  await expect(addressDialog).toContainText("2 of 2");
  await expect(addressDialog.getByRole("heading")).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("popup-address-desktop.png") });
  await addressDialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog.getByRole("heading")).toBeFocused();
  await expect(dialog).toContainText("1 of 2");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#catalog")).toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
});

test("popup action and storefront buttons use the rounded action shape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dialog = page.getByRole("dialog");
  const next = dialog.getByRole("button", { name: "Next", exact: true });
  await expect(dialog).toBeVisible();
  await expect(next).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Close welcome announcement" })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("popup-schedule-mobile.png") });
  await next.click();
  await expect(dialog.getByRole("heading", { name: "Set your delivery address" })).toBeFocused();
  const action = dialog.getByRole("button", { name: "Shop fresh picks" });
  await expect(action).toBeInViewport();
  const imageBounds = await dialog.locator("img.fm-announcement-scene").boundingBox();
  const visualBounds = await dialog.locator(".fm-announcement-media").boundingBox();
  expect(imageBounds!.height).toBeLessThanOrEqual(visualBounds!.height + 1);
  expect(await action.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("9999px");
  await page.screenshot({ path: test.info().outputPath("popup-address-mobile.png") });
  await action.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#catalog")).toBeInViewport();
  const locationAction = page.getByRole("button", { name: "Set delivery location" });
  await expect(locationAction).toBeVisible();
  await expect
    .poll(() => locationAction.evaluate((element) => getComputedStyle(element).borderRadius))
    .toBe("9999px");
});
