import { resolve } from "node:path";
import { z } from "@freshmarkets/validation";
import { test, expect } from "./admin-authenticated-fixture";

for (const width of [1440, 390]) {
  test(`Product image upload and storefront at ${width}px`, async ({
    adminPage: page,
    browser,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    const suffix = crypto.randomUUID();
    const slug = `media-recovery-${suffix}`;
    await page.goto("/admin/catalog/products/new");
    await page.getByLabel("Product name", { exact: true }).fill(`Image recovery ${width}`);
    await page.getByLabel("Product slug").fill(slug);
    await page.getByLabel("Product category").selectOption({ index: 1 });
    await page.getByLabel("Inventory base unit").selectOption("unit-gram");
    await page.getByLabel("SKU", { exact: true }).fill(`MEDIA_${suffix.slice(0, 8)}`);
    await page.getByLabel("Variant name").fill("250 g");
    await page.getByLabel("Sell unit").selectOption("unit-gram");
    await page.getByLabel("Quantity", { exact: true }).fill("250");
    for (let index = 1; index <= 4; index++) {
      await page.getByRole("button", { name: "Add image", exact: true }).click();
      await page
        .getByLabel(`Image ${index}`, { exact: true })
        .setInputFiles(resolve("public/produce/abiu.webp"));
      await page
        .getByLabel("Alt text", { exact: true })
        .nth(index - 1)
        .fill(`Abiu photo ${index}`);
    }
    await expect(
      page.getByRole("img", { name: "Selected product photo", exact: true }),
    ).toHaveCount(4);
    await page.getByRole("button", { name: "Add image", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add image", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Remove image 5", exact: true }).click();
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Image recovery ${width}` }),
    ).toBeVisible();
    const keys: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/api\/admin\/catalog\/products\/[^/]+\/media$/.test(request.url())
      )
        keys.push(request.headers()["idempotency-key"]);
    });
    // Browser interception cannot faithfully forward multipart file contents.
    // Send the native request, then hide its completed response from the caller.
    await page.evaluate(() => {
      const nativeFetch = window.fetch.bind(window);
      let lost = false;
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await nativeFetch(...args);
        const input = args[0];
        const url =
          typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
        if (
          !lost &&
          args[1]?.method === "POST" &&
          /\/api\/admin\/catalog\/products\/[^/]+\/media$/.test(url) &&
          response.ok
        ) {
          lost = true;
          throw new TypeError("Simulated lost upload response");
        }
        return response;
      };
    });
    await page.getByLabel("Product media image").setInputFiles(resolve("public/produce/abiu.webp"));
    await page.getByLabel("Media alt text").fill("Fresh abiu preview");
    await page.getByLabel("Primary image", { exact: true }).check();
    await page.getByRole("button", { name: "Upload image", exact: true }).click();
    await expect(page.getByText("Images updated.", { exact: true })).toBeVisible();
    await expect(page.getByText("All five photo spaces are used.", { exact: false })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    await page.getByRole("combobox", { name: "Price location", exact: true }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await page.getByLabel("Final retail price", { exact: true }).fill("29.50");
    await page.getByRole("button", { name: "Save price", exact: true }).click();
    await expect(page.getByText("Exact-location price saved.", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await page.getByRole("button", { name: "Review start selling", exact: true }).click();
    await page.getByRole("button", { name: "Confirm selling status", exact: true }).click();
    await expect(page.getByText("Availability updated.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save price", exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Global", exact: true }).click();
    await expect(page.getByText("All five photo spaces are used.", { exact: false })).toBeVisible();
    // Cart population uses its real HTTP command; checkout/cycle acceptance is separate.
    const productId = new URL(page.url()).pathname.split("/").at(-1);
    const detail = z
      .object({
        ok: z.literal(true),
        value: z.object({ skus: z.array(z.object({ skuId: z.string() })).min(1) }),
      })
      .parse(
        await (
          await page.request.get(`/api/admin/catalog/products/${productId}?scopeKind=GLOBAL`)
        ).json(),
      );
    const cart = z
      .object({ ok: z.literal(true), value: z.object({ id: z.string(), version: z.number() }) })
      .parse(await (await page.request.get("/api/commerce/cart")).json());
    expect(
      await (
        await page.request.post("/api/commerce/cart", {
          data: {
            cartId: cart.value.id,
            expectedVersion: cart.value.version,
            skuId: detail.value.skus[0].skuId,
            quantity: 1,
            idempotencyKey: crypto.randomUUID(),
          },
        })
      ).json(),
    ).toMatchObject({ ok: true });
    const cartPage = await page.context().newPage();
    await cartPage.setViewportSize({ width, height: 1000 });
    await cartPage.goto("/cart");
    await expect(
      cartPage.getByRole("img", { name: "Fresh abiu preview", exact: true }).first(),
    ).toBeVisible();
    await cartPage.screenshot({
      path: testInfo.outputPath("cart-product-image.png"),
      fullPage: true,
    });
    await cartPage.close();
    const customerContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: { width, height: 1000 },
    });
    try {
      const customer = await customerContext.newPage();
      await customer.goto(new URL(`/products/${slug}`, page.url()).href);
      const image = customer.getByRole("img", { name: "Fresh abiu preview", exact: true }).first();
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (element) =>
              element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const imageUrl = await image.getAttribute("src");
      expect(imageUrl).toContain("/media/products/");
      const response = await customer.request.get(imageUrl!);
      expect(response.status()).toBe(200);
      await customer.screenshot({
        path: testInfo.outputPath("published-product-image.png"),
        fullPage: true,
      });
      await expect(customer.getByRole("button", { name: /^Show photo/ })).toHaveCount(5);
      await customer
        .getByRole("button", { name: "Show photo 2: Abiu photo 1", exact: true })
        .click();
      await expect(customer.getByRole("img", { name: "Abiu photo 1", exact: true })).toBeVisible();
      await page.goto(`/admin/catalog/products/${productId}/edit`);
      await page.getByRole("button", { name: "Replace Fresh abiu preview", exact: true }).click();
      await page
        .getByLabel("Product media image", { exact: true })
        .setInputFiles(resolve("public/produce/abiu.webp"));
      await page.getByLabel("Media alt text", { exact: true }).fill("Fresh abiu replacement");
      await page.getByRole("button", { name: "Replace image", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Replace Fresh abiu replacement", exact: true }),
      ).toBeVisible();
      await customer.reload();
      await expect(
        customer.getByRole("img", { name: "Fresh abiu replacement", exact: true }),
      ).toBeVisible();
      await expect(customer.getByRole("button", { name: /^Show photo/ })).toHaveCount(5);
      await page
        .getByRole("button", { name: "Remove Fresh abiu replacement", exact: true })
        .click();
      await expect(page.getByText("Image removed.", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Product media image", { exact: true })).toBeVisible();
      const lastPhoto = page
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "Save Abiu photo 4", exact: true }) });
      await lastPhoto.getByLabel("Main photo", { exact: true }).check();
      await lastPhoto.getByLabel("Order for Abiu photo 4", { exact: true }).fill("0");
      await lastPhoto.getByRole("button", { name: "Save Abiu photo 4", exact: true }).click();
      await expect(page.getByText("Image saved.", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Image recovery", exact: true })).toHaveCount(
        0,
      );
      const previews = page
        .getByRole("region", { name: "Product images", exact: true })
        .locator("img");
      await expect(previews).toHaveCount(4);
      await expect
        .poll(() =>
          previews.evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
            ),
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("product-image-controls.png"),
        fullPage: true,
      });
      expect(
        (
          await customer.request.get(imageUrl!, {
            headers: { "if-none-match": response.headers().etag },
          })
        ).status(),
      ).toBe(404);
      await customer.reload();
      await expect(customer.getByRole("img", { name: "Abiu photo 4", exact: true })).toBeVisible();
      await expect(customer.getByRole("button", { name: /^Show photo/ })).toHaveCount(4);
      await expect(
        customer.getByRole("img", { name: "Fresh abiu preview", exact: true }),
      ).toHaveCount(0);
      await customer.goto(`/?q=${encodeURIComponent(`Image recovery ${width}`)}`);
      await customer
        .getByRole("link", { name: `Image recovery ${width} details`, exact: true })
        .click();
      const quickView = customer.getByRole("dialog", {
        name: `Image recovery ${width} details`,
        exact: true,
      });
      await expect(quickView.getByRole("button", { name: /^Show photo/ })).toHaveCount(4);
      await quickView
        .getByRole("button", { name: "Show photo 2: Abiu photo 1", exact: true })
        .click();
      await expect(quickView.getByRole("img", { name: "Abiu photo 1", exact: true })).toBeVisible();
      await customer.screenshot({
        path: testInfo.outputPath("quick-view-gallery.png"),
        fullPage: true,
      });
    } finally {
      await customerContext.close();
    }
  });
}
