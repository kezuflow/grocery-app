import type { Locator } from "@playwright/test";
import { expect, test } from "./admin-authenticated-fixture";

async function selectionContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const selection = getComputedStyle(element, "::selection");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    function luminance(color: string) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      if (alpha !== 255) throw new Error("Selection colors must be opaque");
      const linear = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }
    const foreground = luminance(selection.color);
    const background = luminance(selection.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}

async function selectContent(locator: Locator) {
  await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

for (const width of [1440, 390]) {
  test(`Admin text selection is readable in both themes at ${width}px`, async ({
    adminPage: page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/promotions");
    const heading = page.getByRole("heading", { level: 1, name: "Promotion Codes", exact: true });
    await expect(heading).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark")
        await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
      await expect(page.locator("html")).toHaveClass(
        theme === "dark" ? /fm-admin-dark/ : /^(?!.*fm-admin-dark)/,
      );
      await selectContent(heading);
      expect(await selectionContrast(heading)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({
        path: `../../.wrangler/admin-selection-${theme}-${width}.png`,
        animations: "disabled",
      });

      const search = page.getByLabel("Search promo codes on this page");
      await search.fill("Highlight text");
      await search.selectText();
      expect(await selectionContrast(search)).toBeGreaterThanOrEqual(4.5);
      await search.fill("");

      await page.getByRole("button", { name: "Create promo code", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Select promotion type", exact: true });
      await expect(dialog).toBeVisible();
      const title = dialog.getByRole("heading", { name: "Select promotion type", exact: true });
      await selectContent(title);
      expect(await selectionContrast(title)).toBeGreaterThanOrEqual(4.5);
      expect(
        await selectionContrast(
          dialog.getByText("Choose one of the promotion benefits FreshMarkets supports.", {
            exact: true,
          }),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({
        path: `../../.wrangler/admin-selection-portal-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }

    // Admin appearance must not change the Storefront's existing selection pair.
    await page.goto("/");
    await expect(page.locator(".fm-admin")).toHaveCount(0);
    const selection = await page.locator("body").evaluate((element) => {
      const style = getComputedStyle(element, "::selection");
      return { color: style.color, background: style.backgroundColor };
    });
    expect(selection).toEqual({ color: "rgb(31, 61, 36)", background: "rgb(183, 243, 74)" });
  });
}
