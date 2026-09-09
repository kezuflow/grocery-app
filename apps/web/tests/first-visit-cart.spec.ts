import { z } from "@freshmarkets/validation";
import type { APIResponse, Page } from "@playwright/test";
import { test, expect } from "./admin-authenticated-fixture";

test.use({ actionTimeout: 15_000 });

async function value(response: APIResponse): Promise<unknown> {
  const result = z
    .object({
      ok: z.boolean(),
      value: z.unknown().optional(),
      error: z.object({ message: z.string() }).optional(),
    })
    .parse(await response.json());
  if (!result.ok) throw new Error(result.error?.message ?? "Command failed");
  return result.value;
}
const locationId = "location-cebu-central",
  marketId = "market-metro-cebu",
  skuId = "sku-red-onion-500g";
const candidate = {
  candidateKey: "synthetic-search-result",
  displayAddress: "Test delivery entrance, Cebu",
  coordinate: { latitude: 10.32, longitude: 123.9 },
  components: {
    addressLine1: "Test delivery entrance",
    addressLine2: null,
    barangay: null,
    city: "Cebu",
    region: "Cebu",
    postalCode: null,
    countryCode: "PH",
  },
  accuracy: "rooftop",
};

for (const width of [1440, 390]) {
  test(`first visit, remembered location and guest carryover at ${width}px`, async ({
    page,
    adminPage: admin,
    signedInPage: account,
  }, testInfo) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height: 950 });
    const read = async (target: Page, path: string) => value(await target.request.get(path));
    const post = async (target: Page, path: string, data: unknown) =>
      value(
        await target.request.post(path, {
          data,
          headers: { "idempotency-key": crypto.randomUUID() },
        }),
      );
    const configSchema = z.object({
      version: z.number(),
      fulfillmentMode: z.string(),
      sellingState: z.string(),
    });
    let config = configSchema.parse(await read(admin, "/api/admin/commerce-configuration"));
    if (config.fulfillmentMode !== "INSTANT") {
      if (config.sellingState === "OPEN") {
        await post(admin, "/api/admin/commerce-configuration", {
          action: "PAUSE",
          expectedVersion: config.version,
          reason: "Synthetic first-visit journey",
        });
        config = configSchema.parse(await read(admin, "/api/admin/commerce-configuration"));
      }
      await post(admin, "/api/admin/commerce-configuration", {
        action: "SWITCH_MODE",
        fulfillmentMode: "INSTANT",
        cadence: null,
        expectedVersion: config.version,
        reason: "Synthetic first-visit journey",
      });
    }
    async function price(amountMinor: number) {
      const product = z
        .object({
          skus: z.array(z.object({ skuId: z.string(), priceVersion: z.number().nullable() })),
        })
        .parse(
          await read(
            admin,
            `/api/admin/catalog/products/product-red-onion?scopeKind=LOCATION&marketId=${marketId}&locationId=${locationId}`,
          ),
        );
      await post(admin, `/api/admin/catalog/skus/${skuId}/price`, {
        marketId,
        locationId,
        currency: "PHP",
        amountMinor,
        validFrom: Date.now(),
        expectedVersion: product.skus.find((item) => item.skuId === skuId)!.priceVersion,
      });
    }
    await price(100);
    const cart = z
      .object({ id: z.string(), version: z.number() })
      .parse(await read(account, "/api/commerce/cart"));
    await post(account, "/api/commerce/cart", {
      cartId: cart.id,
      skuId,
      quantity: 3,
      expectedVersion: cart.version,
      idempotencyKey: crypto.randomUUID(),
    });
    const session = z
      .object({ user: z.object({ email: z.string() }) })
      .parse(await (await account.request.get("/api/auth/get-session")).json());

    // Only external geocoder search is substituted. Serviceability, catalog,
    // Cart commands and sign-in reach the real local Web/Core services.
    await page.route("**/api/commerce/address-search", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, value: [candidate], requestId: "synthetic-geocoder" }),
      }),
    );
    await page.goto("/");
    const locationDialog = page.getByRole("dialog", {
      name: "Choose delivery address",
      exact: true,
    });
    await expect(locationDialog).toBeVisible();
    await locationDialog
      .getByRole("button", { name: "Skip for now — browse groceries", exact: true })
      .click();
    await expect(locationDialog).toHaveCount(0);
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Add .* to cart$/ })).toHaveCount(0);
    await page.goto("/products/red-onion");
    await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeDisabled();
    const unlocated = z
      .object({
        product: z.object({
          variants: z.array(
            z.object({ availability: z.string(), priceMinor: z.number().nullable() }),
          ),
        }),
      })
      .parse(await read(page, "/api/catalog/product?slug=red-onion"));
    expect(
      unlocated.product.variants.every(
        (item) => item.availability === "LOCATION_REQUIRED" && item.priceMinor === null,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`ca73-unlocated-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Choose delivery address", exact: true }).click();
    await locationDialog
      .getByRole("textbox", { name: /^Search for an address/ })
      .fill("Test delivery entrance");
    await locationDialog
      .getByRole("button", { name: candidate.displayAddress, exact: true })
      .click();
    await expect(locationDialog.getByText("Delivery is available", { exact: true })).toBeVisible();
    await locationDialog.getByRole("button", { name: "Deliver here", exact: true }).click();
    await expect(locationDialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Choose delivery address", exact: true }),
    ).toContainText("Test delivery entrance");
    await page.getByRole("radio", { name: /500 g/ }).check();
    await page.getByRole("button", { name: "Increase quantity", exact: true }).click();
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
    await expect(
      page.getByText("2 × Red onion added to your cart. Sign in to continue when you’re ready.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/cart");
    await expect(
      page.getByRole("button", { name: "Sign in to checkout", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(locationDialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Sign in to checkout", exact: true }),
    ).toBeVisible();
    await price(125);
    const mergeBodies: string[] = [];
    let allowResponse = false;
    await page.route("**/api/commerce/cart/merge", async (route) => {
      mergeBodies.push(route.request().postData() ?? "");
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (!allowResponse) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Sign in to checkout", exact: true }).click();
    const auth = page.getByRole("dialog", { name: "Checkout authentication", exact: true });
    await auth.getByLabel("Email", { exact: true }).fill(session.user.email);
    await auth.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple");
    await auth.getByRole("button", { name: /^Sign in$/i }).click();
    await expect(auth).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Retry loading cart", exact: true }),
    ).toBeVisible();
    allowResponse = true;
    await page.getByRole("button", { name: "Retry loading cart", exact: true }).click();
    await expect(page.getByRole("link", { name: "Checkout", exact: true })).toBeVisible();
    expect(mergeBodies.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mergeBodies).size).toBe(1);
    expect(await read(page, "/api/commerce/cart")).toMatchObject({
      locationId,
      items: [
        { skuId, name: "Red onion · 500 g", quantity: 5, unitPriceMinor: 125, lineTotalMinor: 625 },
      ],
    });
    expect(
      await page.evaluate(() => localStorage.getItem("freshmarkets.guest-cart.v1")),
    ).toBeNull();
    await expect(page.getByText("Red onion · 500 g", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`ca73-carryover-${width}.png`),
      fullPage: true,
    });
  });
}
