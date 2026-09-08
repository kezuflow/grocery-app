import { readFileSync } from "node:fs";
import { expect, test } from "./admin-authenticated-fixture";

for (const width of [1280, 390])
  test(`campaign image publication from Admin to anonymous storefront at ${width}px`, async ({
    adminPage: page,
    browser,
  }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const code = `IMAGE_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
    await page.goto("/admin/promotions");
    await page.getByLabel("Promotion code", { exact: true }).fill(code);
    await page.getByLabel("Promotion name", { exact: true }).fill(`Image campaign ${width}`);
    await page.getByLabel("Fixed discount in pesos", { exact: true }).fill("5.00");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: code, exact: true }) })
      .getByRole("link", { name: "Manage", exact: true })
      .click();
    const editor = page.getByRole("region", { name: "Campaign image", exact: true });
    await expect(editor.getByLabel("Campaign image file")).toBeVisible();
    const file = {
      name: "campaign.png",
      mimeType: "image/png",
      buffer: readFileSync(new URL("../public/promos/fresh-this-week.png", import.meta.url)),
    };
    await editor.getByLabel("Campaign image file").setInputFiles(file);
    await editor.getByLabel("Campaign image description").fill(`Fresh campaign image ${width}`);
    await expect(editor.getByRole("img", { name: "Selected campaign preview" })).toBeVisible();
    await editor.getByRole("button", { name: "Save image", exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText("Campaign image saved.");
    const anonymous = await browser.newContext({ viewport: { width, height: 1000 } });
    const storefront = await anonymous.newPage();
    try {
      await storefront.goto("/");
      await expect(
        storefront.getByRole("img", { name: `Fresh campaign image ${width}`, exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("Reason", { exact: true }).fill("Publish campaign image");
      await page.getByRole("button", { name: "Activate", exact: true }).click();
      await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
      await storefront.reload();
      const image = storefront.getByRole("img", {
        name: `Fresh campaign image ${width}`,
        exact: true,
      });
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const original = await image.getAttribute("src");
      if (!original) throw new Error("Missing public image source");
      await editor.getByLabel("Campaign image file").setInputFiles(file);
      await editor
        .getByLabel("Campaign image description")
        .fill(`Replacement campaign image ${width}`);
      await editor.getByRole("button", { name: "Save image", exact: true }).click();
      await expect(editor.getByRole("status")).toHaveText("Campaign image saved.");
      await storefront.reload();
      const replacement = storefront.getByRole("img", {
        name: `Replacement campaign image ${width}`,
        exact: true,
      });
      await expect(replacement).toBeVisible();
      expect((await storefront.request.get(original)).status()).toBe(404);
      await storefront.screenshot({
        path: testInfo.outputPath(`campaign-storefront-${width}.png`),
        fullPage: true,
      });
      await page.screenshot({
        path: testInfo.outputPath(`campaign-admin-${width}.png`),
        fullPage: true,
      });
      const replacedSource = await replacement.getAttribute("src");
      if (!replacedSource) throw new Error("Missing replacement source");
      await page.getByLabel("Reason", { exact: true }).fill("End campaign");
      await page.getByRole("button", { name: "Deactivate", exact: true }).click();
      await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
      expect((await storefront.request.get(replacedSource)).status()).toBe(404);
      await storefront.reload();
      await expect(
        storefront.getByRole("img", { name: `Replacement campaign image ${width}`, exact: true }),
      ).toHaveCount(0);
      await editor.getByRole("button", { name: "Remove image", exact: true }).click();
      await expect(editor.getByRole("status")).toHaveText("Campaign image removed.");
      await expect(editor.getByText("No campaign image.", { exact: true })).toBeVisible();
    } finally {
      await anonymous.close();
    }
  });
