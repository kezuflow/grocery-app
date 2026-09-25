import { expect, test } from "@playwright/test";

test("welcome announcement opens before shopping and remembers dismissal", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Welcome to FreshMarkets" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Shop this week's picks" })).toBeVisible();
  const shopper = dialog.locator("img.fm-announcement-shopper");
  await expect(shopper).toBeVisible();
  await expect
    .poll(() => shopper.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(dialog.locator("img.fm-announcement-mascot")).toBeVisible();
  const imageBounds = await shopper.boundingBox();
  const visualBounds = await dialog.locator(".fm-announcement-media").boundingBox();
  expect(imageBounds!.height).toBeLessThanOrEqual(visualBounds!.height + 1);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#catalog")).toBeVisible();

  await page.reload();
  await expect(dialog).toHaveCount(0);
});

test("popup action and storefront buttons use the rounded action shape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Welcome to FreshMarkets" });
  const action = dialog.getByRole("button", { name: "Shop this week's picks" });
  await expect(dialog).toBeVisible();
  await expect(action).toBeInViewport();
  const imageBounds = await dialog.locator("img.fm-announcement-shopper").boundingBox();
  const visualBounds = await dialog.locator(".fm-announcement-media").boundingBox();
  expect(imageBounds!.height).toBeLessThanOrEqual(visualBounds!.height + 1);
  expect(await action.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("9999px");
  await action.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#catalog")).toBeInViewport();
  const locationAction = page.getByRole("button", { name: "Set delivery location" });
  await expect(locationAction).toBeVisible();
  await expect
    .poll(() => locationAction.evaluate((element) => getComputedStyle(element).borderRadius))
    .toBe("9999px");
});
