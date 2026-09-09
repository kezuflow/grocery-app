import type { APIResponse } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { test, expect } from "./admin-authenticated-fixture";

async function value(response: APIResponse): Promise<unknown> {
  const data: unknown = await response.json();
  const failure = z
    .object({ ok: z.literal(false), error: z.object({ message: z.string() }) })
    .safeParse(data);
  if (failure.success) throw new Error(failure.data.error.message);
  expect(response.ok()).toBe(true);
  return z.object({ ok: z.literal(true), value: z.unknown() }).parse(data).value;
}
for (const width of [1280, 390]) {
  test(`Warehouse stock to two destinations with partial acceptance at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width, height: 1000 });
    const suffix = crypto.randomUUID(),
      productName = `Transfer onions ${width} ${suffix.slice(0, 5)}`;
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
      [`Mandaue ${suffix.slice(0, 5)}`, "CUSTOMER_FULFILLMENT"],
    ]) {
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
    await page.getByLabel("Inventory base unit").selectOption("unit-gram");
    await page.getByLabel("SKU", { exact: true }).fill(`TRANSFER_${suffix.slice(0, 8)}`);
    await page.getByLabel("Variant name").fill("250 g");
    await page.getByLabel("Sell unit").selectOption("unit-gram");
    await page.getByLabel("Quantity", { exact: true }).fill("250");
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: productName })).toBeVisible();
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: warehouse.name, exact: true }).click();
    await page.goto("/admin/inventory");
    await page.getByLabel(`Stock quantity for ${productName}`).fill("100000");
    const stockRow = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: productName, exact: true }) });
    await stockRow.getByRole("button", { name: "Add stock", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByLabel("Confirmation reason").fill("Opening warehouse stock");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(stockRow).toContainText("100000");
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Global", exact: true }).click();
    const dispatches: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/transfers/*/dispatch", async (route) => {
      dispatches.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (dispatches.length > 1) return route.continue();
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort("failed");
    });
    for (const target of locations.slice(1)) {
      await page.goto("/admin/transfers");
      await page.getByRole("button", { name: "Create transfer", exact: true }).click();
      await page.getByRole("combobox", { name: "Source warehouse", exact: true }).click();
      await page.getByRole("option", { name: warehouse.name, exact: true }).click();
      await page.getByRole("combobox", { name: "Destination", exact: true }).click();
      await page.getByRole("option", { name: target.name, exact: true }).click();
      await page.getByLabel("Find product", { exact: true }).fill(productName);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByLabel(`Send ${productName} (grams)`, { exact: true }).fill("20000");
      await page.getByLabel("Reason", { exact: true }).fill("Destination replenishment");
      await page.getByRole("button", { name: "Create draft", exact: true }).click();
      await page
        .getByRole("link", { name: `${warehouse.name} → ${target.name}`, exact: true })
        .click();
      await page.getByLabel("Reason for action", { exact: true }).fill("Checked at dispatch");
      await page.getByRole("button", { name: "Dispatch transfer", exact: true }).click();
      if (dispatches.length === 1) {
        await expect(
          page.getByText("The action could not be confirmed.", { exact: false }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Dispatch transfer", exact: true }).click();
        expect(dispatches[1]).toEqual(dispatches[0]);
      }
      await expect(
        page.getByRole("button", { name: "Record checked goods", exact: true }),
      ).toBeVisible();
      for (const quantity of [5000, 15000]) {
        await page
          .getByLabel(`Accept ${productName} (grams)`, { exact: true })
          .fill(String(quantity));
        await page
          .getByLabel("Reason for action", { exact: true })
          .fill("Inspected sellable goods");
        await page.getByRole("button", { name: "Record checked goods", exact: true }).click();
        await expect(
          page.getByText(quantity === 5000 ? "partially received" : "received", { exact: true }),
        ).toBeVisible();
      }
    }
    const options = z.object({
      products: z.array(
        z.object({ inventoryPoolId: z.string(), productName: z.string(), onHandBase: z.number() }),
      ),
    });
    const onHand = [];
    for (const location of locations) {
      const result = options.parse(
        await value(
          await page.request.get(
            `/api/admin/transfers/options?sourceLocationId=${location.locationId}&query=${encodeURIComponent(productName)}`,
          ),
        ),
      );
      onHand.push(
        result.products.find((product) => product.productName === productName)?.onHandBase,
      );
    }
    expect(onHand).toEqual([60000, 20000, 20000]);
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
    await page.getByLabel("Reason", { exact: true }).fill("Discrepancy acceptance journey");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "draft", exact: true }) })
      .getByRole("link", { name: `${warehouse.name} → ${target.name}`, exact: true })
      .click();
    await page.getByLabel("Reason for action", { exact: true }).fill("Dispatch checked goods");
    await page.getByRole("button", { name: "Dispatch transfer", exact: true }).click();
    await page.getByLabel(`Accept ${productName} (grams)`, { exact: true }).fill("15000");
    await page.getByLabel(`Damaged remaining for ${productName}`, { exact: true }).fill("3000");
    await page.getByLabel(`Missing remaining for ${productName}`, { exact: true }).fill("2000");
    await page
      .getByLabel("Reason for action", { exact: true })
      .fill("Inspected arrival: damage and shortage");
    await page.getByRole("button", { name: "Record checked goods", exact: true }).click();
    await expect(page.getByText("partially received", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`warehouse-discrepancy-${width}.png`),
      fullPage: true,
    });
    const resolutions: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/transfers/*/resolve", async (route) => {
      resolutions.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (resolutions.length > 1) return route.continue();
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("combobox", { name: "Product to resolve", exact: true }).click();
    await page.getByRole("option", { name: productName, exact: true }).click();
    await page.getByRole("combobox", { name: "Outstanding goods", exact: true }).click();
    await page.getByRole("option", { name: "Reported missing goods", exact: true }).click();
    await page.getByLabel("Quantity (grams)", { exact: true }).fill("2000");
    await page
      .getByLabel("Reason for action", { exact: true })
      .fill("Verified shortage, approved loss");
    await page.getByRole("button", { name: "Save resolution", exact: true }).click();
    await expect(
      page.getByText("The action could not be confirmed.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save resolution", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Latest resolutions (up to 100)", exact: true }),
    ).toBeVisible();
    expect(resolutions[1]).toEqual(resolutions[0]);
    await page.getByRole("combobox", { name: "Outstanding goods", exact: true }).click();
    await page.getByRole("option", { name: "Reported damaged goods", exact: true }).click();
    await page.getByRole("combobox", { name: "Resolution", exact: true }).click();
    await page.getByRole("option", { name: "Verify sellable return", exact: true }).click();
    await page.getByLabel("Quantity (grams)", { exact: true }).fill("3000");
    await page
      .getByLabel("Reason for action", { exact: true })
      .fill("Returned and reinspected as sellable");
    await expect(page.getByRole("button", { name: "Save resolution", exact: true })).toBeDisabled();
    await page
      .getByLabel("Physically received at the warehouse and inspected as sellable", { exact: true })
      .check();
    await page.getByRole("button", { name: "Save resolution", exact: true }).click();
    await expect(page.getByText("resolved", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`warehouse-resolved-${width}.png`),
      fullPage: true,
    });
    await page.goto("/admin/transfers");
    await page.getByRole("button", { name: "View distribution", exact: true }).click();
    await page.getByLabel("Distribution product search", { exact: true }).fill(productName);
    await page.getByRole("button", { name: "Find stock", exact: true }).click();
    const distribution = page.getByRole("region", {
      name: "Global stock distribution",
      exact: true,
    });
    await expect(distribution.getByRole("article")).toHaveCount(1);
    await expect(distribution.getByRole("heading", { level: 3 })).toContainText(productName);
    await expect(distribution.getByText("98,000", { exact: true })).toBeVisible();
    await expect(distribution.getByText("43,000", { exact: true })).toBeVisible();
    await expect(distribution.getByText("55,000", { exact: true })).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`warehouse-distribution-${width}.png`),
      fullPage: true,
    });
  });
}
