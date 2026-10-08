import { expect, test, type Locator } from "@playwright/test";

async function expectPage(popover: Locator, number: number) {
  await expect(popover.getByRole("status", { name: "Announcement page" })).toHaveText(
    `${number} of 2`,
  );
}

test("welcome announcement opens on every home visit with the scheduled delivery message", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = page.getByRole("region", { name: "FreshMarkets welcome" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await expect(dialog.getByRole("button", { name: /^(Play|Pause) announcements$/ })).toHaveCount(0);
  await dialog.getByRole("heading").focus();
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
  await expectPage(dialog, 1);
  const pageButtons = dialog.getByRole("group", { name: "Announcement pages" }).getByRole("button");
  await expect(pageButtons).toHaveCount(2);
  const cardBounds = await dialog.boundingBox();
  const pagesBounds = await dialog.getByRole("status", { name: "Announcement page" }).boundingBox();
  const frameBounds = await dialog.locator(".fm-announcement-media").boundingBox();
  if (!frameBounds) throw new Error("Announcement image frame is not visible");
  expect(pagesBounds!.x).toBeGreaterThan(cardBounds!.x + cardBounds!.width / 2);
  for (const button of await pageButtons.all()) {
    const bounds = await button.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    if (!bounds) throw new Error("Announcement navigation is not visible");
    expect(bounds.x).toBeGreaterThanOrEqual(frameBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(frameBounds.x + frameBounds.width);
    expect(bounds.y).toBeGreaterThanOrEqual(frameBounds.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(frameBounds.y + frameBounds.height);
  }
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
  await dialog.screenshot({ path: test.info().outputPath("welcome-gallery-card-desktop.png") });

  await dialog.getByRole("button", { name: "Next announcement page", exact: true }).click();
  const addressDialog = page.getByRole("region", { name: "FreshMarkets welcome" });
  await expect(addressDialog).toContainText(
    "Set your address to see local prices and place an order.",
  );
  await expectPage(addressDialog, 2);
  await expect(addressDialog.getByRole("heading")).toBeFocused();
  await expect(addressDialog.getByRole("img")).toHaveAttribute(
    "src",
    "/announcements/welcome-delivery-address-v1.webp",
  );
  await expect
    .poll(() =>
      addressDialog.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath("popup-address-desktop.png") });
  await addressDialog
    .getByRole("button", { name: "Previous announcement page", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("heading")).toBeFocused();
  await expectPage(dialog, 1);
  await expect(dialog.getByRole("img")).toHaveAttribute(
    "src",
    "/announcements/welcome-market-scene.webp",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#catalog")).toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await addressDialog.getByRole("button", { name: "Set delivery address", exact: true }).click();
  await expect(addressDialog).toHaveCount(0);
  const selector = page.getByRole("dialog", { name: "Choose delivery address" });
  await expect(selector).toBeVisible();
  await expect(selector.getByRole("heading", { name: "Deliver to", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(selector).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Choose delivery address", exact: true }),
  ).toBeFocused();
});

test("outside clicks dismiss the announcement and preserve the chosen storefront focus", async ({
  page,
}) => {
  await page.goto("/");
  const popover = page.getByRole("region", { name: "FreshMarkets welcome" });
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Next announcement page", exact: true }).click();
  await expect(popover.getByRole("heading")).toBeFocused();
  const search = page.getByRole("textbox", { name: "Search groceries", exact: true });
  await search.click();
  await expect(popover).toHaveCount(0);
  await expect(search).toBeFocused();

  await page.reload();
  await expect(popover).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(popover).toHaveCount(0);

  await page.reload();
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Close welcome announcement" }).click();
  await expect(popover).toHaveCount(0);
});

test("welcome popover autoplays both pages, pauses on hover and focus, and allows browsing", async ({
  page,
}) => {
  const now = new Date("2026-10-08T04:00:00Z");
  await page.clock.install({ time: now });
  await page.goto("/");
  const popover = page.getByRole("region", { name: "FreshMarkets welcome" });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("button", { name: /^(Play|Pause) announcements$/ })).toHaveCount(
    0,
  );
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  await page.clock.runFor(6_100);
  await expect(popover.getByRole("heading")).toHaveText("Set your delivery address");
  expect(await popover.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await page.clock.runFor(6_100);
  await expect(popover.getByRole("heading")).toHaveText("Welcome to FreshMarkets");

  await popover.hover();
  await page.clock.runFor(12_100);
  await expectPage(popover, 1);
  await page.mouse.move(0, 0);
  await page.clock.runFor(6_100);
  await expectPage(popover, 2);

  await popover.getByRole("button", { name: "Next announcement page", exact: true }).focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(12_100);
  await expectPage(popover, 2);
  const search = page.getByRole("textbox", { name: "Search groceries", exact: true });
  await search.focus();
  await page.clock.runFor(6_100);
  await expectPage(popover, 1);
  await expect(search).toBeFocused();

  await popover.getByRole("button", { name: "Next", exact: true }).focus();
  await page.clock.runFor(12_100);
  await expectPage(popover, 1);
  await expect(popover.getByRole("button", { name: "Next", exact: true })).toBeFocused();

  // The storefront remains interactive. Outside activation dismisses the guide
  // and opens the existing address selector in the same click.
  await page.getByRole("button", { name: "Choose delivery address", exact: true }).click();
  await page.clock.runFor(100);
  await expect(popover).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Choose delivery address" })).toBeVisible();
});

test("reduced motion keeps onboarding pages manual without playback controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const now = new Date("2026-10-08T04:00:00Z");
  await page.clock.install({ time: now });
  await page.goto("/");
  const popover = page.getByRole("region", { name: "FreshMarkets welcome" });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("button", { name: /^(Play|Pause) announcements$/ })).toHaveCount(
    0,
  );
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  await page.clock.runFor(12_100);
  await expectPage(popover, 1);
  await popover.getByRole("button", { name: "Next announcement page", exact: true }).click();
  await page.clock.runFor(12_100);
  await expectPage(popover, 2);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("textbox", { name: "Search groceries", exact: true }).focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(6_100);
  await expectPage(popover, 1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(12_100);
  await expectPage(popover, 1);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
});

test("popup action and storefront buttons use the rounded action shape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dialog = page.getByRole("region", { name: "FreshMarkets welcome" });
  const next = dialog.getByRole("button", { name: "Next", exact: true });
  await expect(dialog).toBeVisible();
  await expect(next).toBeInViewport();
  await next.focus();
  await expect(dialog.getByRole("button", { name: "Close welcome announcement" })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("popup-schedule-mobile.png") });
  await next.click();
  await expect(dialog.getByRole("heading", { name: "Set your delivery address" })).toBeFocused();
  const action = dialog.getByRole("button", { name: "Set delivery address", exact: true });
  await expect(action).toBeInViewport();
  await expect
    .poll(() => dialog.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const imageBounds = await dialog.locator("img.fm-announcement-scene").boundingBox();
  const visualBounds = await dialog.locator(".fm-announcement-media").boundingBox();
  expect(imageBounds!.height).toBeLessThanOrEqual(visualBounds!.height + 1);
  expect(await action.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("9999px");
  await page.screenshot({ path: test.info().outputPath("popup-address-mobile.png") });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(action).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "Close welcome announcement" })).toBeInViewport({
    ratio: 1,
  });
  await expect(dialog.getByRole("button", { name: "Previous announcement page" })).toBeInViewport({
    ratio: 1,
  });
  await expect(
    dialog.getByRole("button", { name: "Next announcement page", exact: true }),
  ).toBeInViewport({
    ratio: 1,
  });
  const popoverBounds = await dialog.boundingBox();
  expect(popoverBounds!.x).toBeGreaterThanOrEqual(0);
  expect(popoverBounds!.x + popoverBounds!.width).toBeLessThanOrEqual(320);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.screenshot({ path: test.info().outputPath("popup-address-small-mobile.png") });
  await action.click();
  await expect(dialog).toHaveCount(0);
  const selector = page.getByRole("dialog", { name: "Choose delivery address" });
  await expect(selector).toBeVisible();
  await expect(selector.getByRole("heading", { name: "Deliver to", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(selector).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(documentWidth);
  const locationAction = page.getByRole("button", { name: "Set delivery location" });
  await expect(locationAction).toBeVisible();
  await expect
    .poll(() => locationAction.evaluate((element) => getComputedStyle(element).borderRadius))
    .toBe("9999px");
});

test.describe("touch welcome popover", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("touching the image does not leave autoplay paused", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    const popover = page.getByRole("region", { name: "FreshMarkets welcome" });
    await expect(popover).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    await popover.getByRole("img").tap();
    await page.clock.runFor(6_100);
    await expectPage(popover, 2);
    await page.clock.runFor(6_100);
    await expectPage(popover, 1);
    await popover.getByRole("button", { name: "Next announcement page", exact: true }).tap();
    await page.clock.runFor(12_100);
    await expectPage(popover, 2);
    await page.touchscreen.tap(2, 2);
    await expect(popover).toHaveCount(0);
  });
});

test("address action remains usable when the second-page image fails", async ({ page }) => {
  await page.route("**/announcements/welcome-delivery-address-v1.webp", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const dialog = page.getByRole("region", { name: "FreshMarkets welcome" });
  await expect(dialog).toContainText("Set your address to see local prices and place an order.");
  await dialog.getByRole("button", { name: "Set delivery address", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Choose delivery address" })).toBeVisible();
});
