import type { APIResponse } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { test, expect } from "./admin-authenticated-fixture";

async function value(response: Pick<APIResponse, "ok" | "json">): Promise<unknown> {
  const data: unknown = await response.json();
  const failure = z
    .object({ ok: z.literal(false), error: z.object({ message: z.string() }) })
    .safeParse(data);
  if (failure.success) throw new Error(failure.data.error.message);
  expect(response.ok()).toBe(true);
  return z.object({ ok: z.literal(true), value: z.unknown() }).parse(data).value;
}
for (const width of [1280, 390]) {
  test(`Actual counted sizes from bulk receipt to stock at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width, height: 1000 });
    const suffix = crypto.randomUUID(),
      productName = `Counted broccoli ${width} ${suffix.slice(0, 5)}`;
    const post = async (path: string, data: Record<string, unknown>) =>
      value(
        await page.request.post(path, {
          data,
          headers: { "idempotency-key": crypto.randomUUID() },
        }),
      );
    const locations: { locationId: string; name: string }[] = [];
    // Site setup uses real same-origin Core commands; only the authenticated staff fixture uses SQL.
    for (const [name, purpose] of [
      [`Warehouse ${suffix.slice(0, 5)}`, "CENTRAL_WAREHOUSE"],
      [`Cebu ${suffix.slice(0, 5)}`, "CUSTOMER_FULFILLMENT"],
    ]) {
      if (purpose === "CUSTOMER_FULFILLMENT") {
        locations.push({ locationId: "location-cebu-central", name: "Central Cebu" });
        continue;
      }
      const created = z
        .object({ locationId: z.string(), version: z.number(), name: z.string() })
        .parse(
          await post("/api/admin/locations", {
            action: "CREATE",
            name,
            purpose,
            code: `site-${crypto.randomUUID()}`,
            marketId: "market-metro-cebu",
            reason: "Synthetic transfer acceptance site",
            latitude: 10.32,
            longitude: 123.91,
            componentsSource: "FIRST_PARTY",
            confirmationSource: "USER_PIN",
            address: {
              addressLine1: "Synthetic test street",
              addressLine2: null,
              barangay: null,
              city: "Cebu",
              region: "Cebu",
              countryCode: "PH",
              postalCode: null,
            },
            capabilities:
              purpose === "CENTRAL_WAREHOUSE"
                ? ["RECEIVING", "INVENTORY"]
                : ["PICKING", "PACKING", "DISPATCH"],
          }),
        );
      await post("/api/admin/locations", {
        action: "ACTIVATE",
        locationId: created.locationId,
        expectedVersion: created.version,
        reason: "Synthetic active site",
      });
      locations.push(created);
    }
    const warehouse = locations[0];
    if (!warehouse) throw new Error("Missing warehouse");
    await page.goto("/admin/catalog/products/new");
    await page.getByLabel("Product name", { exact: true }).fill(productName);
    await page.getByLabel("Product slug").fill(`transfer-${suffix}`);
    await page.getByLabel("Product category").selectOption({ index: 1 });
    await page.getByLabel("Stock sold by").selectOption("COUNTED_SIZES");
    await page.getByLabel("SKU", { exact: true }).fill(`SMALL_${suffix.slice(0, 8)}`);
    await page.getByLabel("Variant name").fill("Small");
    await page.getByLabel("Sell unit").selectOption("Pack");
    await page.getByLabel("Approximate weight per piece/pack (grams)").fill("300");
    await page.getByRole("button", { name: "Add variant", exact: true }).click();
    await page
      .getByLabel("SKU", { exact: true })
      .nth(1)
      .fill(`LARGE_${suffix.slice(0, 8)}`);
    await page.getByLabel("Variant name").nth(1).fill("Large");
    await page.getByLabel("Sell unit").nth(1).selectOption("Pack");
    await page.getByLabel("Approximate weight per piece/pack (grams)").nth(1).fill("700");
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: productName })).toBeVisible();
    const productUrl = page.url();
    const productId = new URL(productUrl).pathname.split("/").at(-1);
    if (!productId) throw new Error("Missing created product");
    // Adding another counted option also uses the normal authoring form.
    await page.getByLabel("SKU code", { exact: true }).fill(`MEDIUM_${suffix.slice(0, 8)}`);
    await page.getByLabel("Display name", { exact: true }).fill("Medium");
    await page.getByLabel("Unit", { exact: true }).selectOption("Pack");
    await page.getByLabel("Estimated shipping weight", { exact: true }).fill("500");
    await page.getByRole("button", { name: "Add variant", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Edit variant Medium", exact: true }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: warehouse.name, exact: true }).click();
    await page.goto("/admin/inventory");
    await page.getByLabel(`Stock quantity for ${productName}`, { exact: true }).fill("20000");
    const stockRow = page
      .getByRole("row")
      .filter({ has: page.getByText(productName, { exact: true }) });
    await stockRow.getByRole("button", { name: "Add stock", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByLabel("Confirmation reason").fill("Opening warehouse stock");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(stockRow).toContainText("20000");
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Global", exact: true }).click();
    const target = locations[1];
    if (!target) throw new Error("Missing destination");
    await page.goto("/admin/transfers");
    await page.getByRole("button", { name: "Create transfer", exact: true }).click();
    await page.getByRole("combobox", { name: "Source warehouse", exact: true }).click();
    await page.getByRole("option", { name: warehouse.name, exact: true }).click();
    await page.getByRole("combobox", { name: "Destination", exact: true }).click();
    await page.getByRole("option", { name: target.name, exact: true }).click();
    await page.getByLabel("Find product", { exact: true }).fill(productName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel(`Send ${productName} (grams)`, { exact: true }).fill("20000");
    await page.getByLabel("Reason", { exact: true }).fill("Actual size count acceptance");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page
      .getByRole("link", { name: `${warehouse.name} → ${target.name}`, exact: true })
      .click();
    await page.getByLabel("Reason for action", { exact: true }).fill("Dispatch measured bulk");
    await page.getByRole("button", { name: "Dispatch transfer", exact: true }).click();
    await page.getByLabel(`Accept ${productName} (grams)`, { exact: true }).fill("18000");
    await page.getByLabel(`Missing remaining for ${productName}`, { exact: true }).fill("2000");
    await page.getByLabel(`Count Small for ${productName}`).fill("20");
    await page.getByLabel(`Count Large for ${productName}`).fill("10");
    await page
      .getByLabel("Reason for action", { exact: true })
      .fill("Inspected and counted received goods");
    await page.getByRole("button", { name: "Record checked goods", exact: true }).click();
    await expect(page.getByText("partially received", { exact: true })).toBeVisible();
    await expect(
      page.getByText("18,000 g receipt · Small: 20 pieces/packs", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`counted-receipt-${width}.png`),
      fullPage: true,
    });
    await page.getByLabel(`Accept ${productName} (grams)`, { exact: true }).fill("2000");
    await page.getByLabel(`Missing remaining for ${productName}`, { exact: true }).fill("0");
    await expect(page.getByLabel(`Count Small for ${productName}`)).toHaveValue("");
    await page
      .getByLabel("Reason for action", { exact: true })
      .fill("Recovered remaining goods for later counting");
    await page.getByRole("button", { name: "Record checked goods", exact: true }).click();
    await expect(page.getByText("received", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: target.name, exact: true }).click();
    await page.goto("/admin/inventory");
    const row = (name: string) =>
      page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
    await expect(row(productName)).toContainText("2000");
    await row(productName).getByRole("button", { name: "Count sizes" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Measured grams being counted").fill("2000");
    await sheet.getByLabel("Small pieces/packs").fill("2");
    await sheet.getByLabel("Large pieces/packs").fill("1");
    await sheet.getByLabel("Reason", { exact: true }).fill("Count the remaining measured bulk");
    const attempts: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/inventory/sort", async (route) => {
      attempts.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (attempts.length > 1) return route.continue();
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort("failed");
    });
    await sheet.getByRole("button", { name: "Save counts" }).click();
    await expect(
      sheet.getByText("The action could not be confirmed.", { exact: false }),
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Save counts" }).click();
    await expect(sheet).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await expect(row(`${productName} — Small`)).toContainText("22");
    await expect(row(`${productName} — Large`)).toContainText("11");
    await expect(
      row(`${productName} — Small`).getByRole("button", { name: "Add stock", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel(`Stock quantity for ${productName} — Small`, { exact: true }).fill("1");
    await row(`${productName} — Small`)
      .getByRole("button", { name: "Remove stock", exact: true })
      .click();
    await dialog.getByLabel("Confirmation reason").fill("One damaged counted pack removed");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(`${productName} — Small`)).toContainText("21");
    await row(`${productName} — Small`).screenshot({
      path: testInfo.outputPath(`counted-small-${width}.png`),
    });
    await row(productName).screenshot({ path: testInfo.outputPath(`counted-bulk-${width}.png`) });
    await page.screenshot({
      path: testInfo.outputPath(`counted-inventory-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const detail = z
      .object({ skus: z.array(z.object({ skuId: z.string(), name: z.string() })) })
      .parse(
        await value(
          await page.request.get(`/api/admin/catalog/products/${productId}?scopeKind=GLOBAL`),
        ),
      );
    const small = detail.skus.find((sku) => sku.name === "Small");
    if (!small) throw new Error("Missing Small variant");
    const locationId = target.locationId;
    const reason = "Synthetic counted-stock checkout prerequisites";
    const versioned = z.object({ version: z.number() });
    await post(`/api/admin/catalog/skus/${small.skuId}/price`, {
      marketId: "market-metro-cebu",
      locationId,
      currency: "PHP",
      amountMinor: 100000,
      validFrom: Date.now() - 1000,
      expectedVersion: 0,
    });
    await value(
      await page.request.put(`/api/admin/catalog/skus/${small.skuId}/availability`, {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: { locationId, availabilityStatus: "AVAILABLE", expectedVersion: 0 },
      }),
    );
    const schedule = versioned.parse(
      await value(await page.request.get(`/api/admin/location-schedule?locationId=${locationId}`)),
    );
    await post("/api/admin/location-schedule", {
      locationId,
      expectedVersion: schedule.version,
      reason,
      schedule: {
        weekly: Array.from({ length: 7 }, (_, index) => ({
          dayOfWeek: index + 1,
          opensMinute: 0,
          closesMinute: 1440,
        })),
        closures: [],
      },
    });
    const profile = z
      .object({ profile: z.object({ version: z.number() }).nullable() })
      .parse(
        await value(
          await page.request.get(`/api/admin/delivery-location-profile?locationId=${locationId}`),
        ),
      );
    await value(
      await page.request.put("/api/admin/delivery-location-profile", {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: {
          locationId,
          expectedVersion: profile.profile?.version ?? 0,
          senderName: "Synthetic dispatch",
          phoneE164: "+639171110000",
          formattedAddress: "Test road, Cebu",
          addressLine1: "Test road",
          city: "Cebu",
          countryCode: "PH",
        },
      }),
    );
    const readiness = versioned.parse(
      await value(
        await page.request.get(`/api/admin/location-fulfillment?locationId=${locationId}`),
      ),
    );
    await post("/api/admin/location-fulfillment", {
      locationId,
      expectedVersion: readiness.version,
      reason,
      dispatchReady: true,
      instantPromiseMinutes: 90,
    });
    const configuration = z.object({
      version: z.number(),
      sellingState: z.string(),
      fulfillmentMode: z.string(),
    });
    let config = configuration.parse(
      await value(await page.request.get("/api/admin/commerce-configuration")),
    );
    if (config.sellingState === "OPEN") {
      await post("/api/admin/commerce-configuration", {
        action: "PAUSE",
        expectedVersion: config.version,
        reason,
      });
      config = configuration.parse(
        await value(await page.request.get("/api/admin/commerce-configuration")),
      );
    }
    if (config.fulfillmentMode !== "INSTANT") {
      await post("/api/admin/commerce-configuration", {
        action: "SWITCH_MODE",
        fulfillmentMode: "INSTANT",
        cadence: null,
        expectedVersion: config.version,
        reason,
      });
      config = configuration.parse(
        await value(await page.request.get("/api/admin/commerce-configuration")),
      );
    }
    await post("/api/admin/commerce-configuration", {
      action: "OPEN",
      expectedVersion: config.version,
      reason,
    });
    await post("/api/commerce/address", {
      label: "Campaign test address",
      recipient: "Synthetic customer",
      phone: "+639171110001",
      components: {
        addressLine1: "Test customer road",
        addressLine2: null,
        barangay: null,
        city: "Cebu",
        region: "Cebu",
        postalCode: null,
        countryCode: "PH",
      },
      componentsSource: "FIRST_PARTY",
      latitude: 10.32,
      longitude: 123.9,
      confirmationSource: "USER_PIN",
      instructions: {
        buildingUnit: null,
        landmark: null,
        gateGuard: null,
        deliveryNote: null,
        recipientInstruction: null,
      },
    });
    const cart = z
      .object({ id: z.string(), version: z.number() })
      .parse(await value(await page.request.get("/api/commerce/cart")));
    await post("/api/commerce/cart", {
      cartId: cart.id,
      expectedVersion: cart.version,
      skuId: small.skuId,
      quantity: 2,
      idempotencyKey: crypto.randomUUID(),
    });

    await page.goto("/checkout");
    await page.getByRole("radio").first().check();
    const quoteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/checkout/quote") && response.request().method() === "POST",
    );
    await page
      .getByRole("group", { name: "Fulfillment option", exact: true })
      .getByRole("button")
      .first()
      .click();
    const quote = z
      .object({ quoteId: z.string(), merchandiseSubtotalMinor: z.number() })
      .parse(await value(await quoteResponse));
    expect(quote.merchandiseSubtotalMinor).toBe(200000);
    await expect(page.getByRole("region", { name: "Order total review" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`counted-checkout-${width}.png`),
      fullPage: true,
    });
  });
}
