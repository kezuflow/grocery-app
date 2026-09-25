import { expect, test } from "@playwright/test";

test("welcome announcement opens on every home visit with the scheduled delivery message", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Welcome to FreshMarkets" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "We're accepting scheduled orders Monday through Friday for delivery on Saturday or Sunday. Stay tuned for updates on instant delivery.",
  );
  await expect(dialog.getByRole("button", { name: "Shop fresh picks" })).toBeVisible();
  const scene = dialog.locator("img.fm-announcement-scene");
  await expect(scene).toBeVisible();
  await expect
    .poll(() => scene.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(dialog.locator("img.fm-announcement-mascot")).toBeVisible();
  const imageBounds = await scene.boundingBox();
  const visualBounds = await dialog.locator(".fm-announcement-media").boundingBox();
  expect(imageBounds!.height).toBeLessThanOrEqual(visualBounds!.height + 1);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#catalog")).toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
});

test("popup action and storefront buttons use the rounded action shape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Welcome to FreshMarkets" });
  const action = dialog.getByRole("button", { name: "Shop fresh picks" });
  await expect(dialog).toBeVisible();
  await expect(action).toBeInViewport();
  const imageBounds = await dialog.locator("img.fm-announcement-scene").boundingBox();
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
