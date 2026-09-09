import { z } from "@freshmarkets/validation";
import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";
for (const width of [1440, 390])
  test(`Weighed Scheduled sizes to packing at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    const id = crypto.randomUUID(),
      productName = `Scheduled broccoli ${width} ${id.slice(0, 5)}`,
      weekName = `Counted week ${width} ${id.slice(0, 5)}`,
      now = Date.now();
    await page.goto("/admin/catalog/products/new");
    await page.getByLabel("Product name", { exact: true }).fill(productName);
    await page.getByLabel("Product slug").fill(`scheduled-${id}`);
    await page.getByLabel("Product category").selectOption({ index: 1 });
    await page.getByLabel("Stock sold by").selectOption("COUNTED_SIZES");
    await page.getByLabel("SKU", { exact: true }).fill(`SMALL_${id.slice(0, 8)}`);
    await page.getByLabel("Variant name").fill("Small");
    await page.getByLabel("Sell unit").selectOption("Pack");
    await page.getByLabel("Approximate weight per piece/pack (grams)").fill("300");
    await page.getByRole("button", { name: "Add variant", exact: true }).click();
    await page
      .getByLabel("SKU", { exact: true })
      .nth(1)
      .fill(`LARGE_${id.slice(0, 8)}`);
    await page.getByLabel("Variant name").nth(1).fill("Large");
    await page.getByLabel("Sell unit").nth(1).selectOption("Pack");
    await page.getByLabel("Approximate weight per piece/pack (grams)").nth(1).fill("700");
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: productName })).toBeVisible();
    const productId = new URL(page.url()).pathname.split("/").at(-1);
    if (!productId) throw new Error("Missing product");
    const detail = z
      .object({
        ok: z.literal(true),
        value: z.object({
          skus: z.array(z.object({ skuId: z.string(), name: z.string(), stockPoolId: z.string() })),
        }),
      })
      .parse(
        await (
          await page.request.get(`/api/admin/catalog/products/${productId}?scopeKind=GLOBAL`)
        ).json(),
      ).value;
    // Only historical payment/cycle commitment is seeded. All authoring, purchases, receiving and packing use ordinary UI/Core commands.
    executeAdminE2eSql(`INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,delivery_date,cutoff_at,status,capacity,allocated,version) VALUES ('${id}','market-metro-cebu','${weekName}',${now - 86400000},${now + 86400000},${now - 60000},'CUTOFF_REACHED',0,0,1);
  INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('u-${id}','Synthetic buyer','counted-${id}@example.com',1,${now},${now});
  INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES ('c-${id}','u-${id}','active',${now},${now});
  INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('p-${id}','c-${id}',500,'PHP','SUCCEEDED','mock','p-${id}',${now},${now});
  INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at) VALUES ('o-${id}','c-${id}','p-${id}','${id}','SCHEDULED','COMMITTED',500,'PHP','{}',${now});
  INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES ('f-${id}','o-${id}','location-cebu-central','NOT_STARTED',1,${now});
  ${detail.skus
    .map((sku) => {
      const quantity = sku.name === "Small" ? 2 : 3,
        grams = sku.name === "Small" ? 300 : 700;
      return `INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams) VALUES ('line-${sku.skuId}','o-${id}','${sku.skuId}','Broccoli','${sku.name}','PIECE',${quantity},100,${quantity * 100},${quantity},'PIECE',${quantity * grams});
  INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at) VALUES ('d-${sku.skuId}','o-${id}','${id}','location-cebu-central','${sku.stockPoolId}',${quantity},'OPEN','EXACT_PAID_LINE','line-${sku.skuId}','${sku.skuId}',${quantity},${quantity},'PIECE',${quantity * grams},${now});`;
    })
    .join("\n")}`);
    await page.goto("/admin/procurement");
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(id);
    for (const name of ["Small", "Large"]) {
      const item = page.getByRole("article").filter({ hasText: `${productName} · ${name}` });
      await item.getByRole("button", { name: "Confirm purchase", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Confirm purchase", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(item).toContainText("ordered");
    }
    await page.getByRole("link", { name: "Receiving", exact: true }).click();
    await page
      .getByRole("button", { name: `Receive and count ${productName} · ${weekName}`, exact: true })
      .click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Received bulk weight (g)", { exact: true }).fill("3500");
    await sheet.getByLabel("Accepted Small", { exact: true }).fill("2");
    await sheet.getByLabel("Accepted Large", { exact: true }).fill("3");
    const attempts: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/receiving/counted", async (route) => {
      attempts.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (attempts.length > 1) return route.continue();
      expect(await (await route.fetch()).json()).toMatchObject({ ok: true });
      await route.abort("failed");
    });
    await sheet.getByRole("button", { name: "Save received counts", exact: true }).click();
    await expect(
      sheet.getByText("The action could not be confirmed.", { exact: false }),
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Save received counts", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    const history = page
      .getByRole("article")
      .filter({ hasText: `${productName} · 3,500 g measured` });
    await expect(history).toContainText("Small: 2 accepted");
    await expect(history).toContainText("Large: 3 accepted");
    await page.screenshot({
      path: testInfo.outputPath(`scheduled-counts-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.goto("/admin/fulfillment");
    const row = page.getByRole("row").filter({ hasText: `o-${id}` });
    for (const name of [
      "Accept order & start picking",
      "Finish picking",
      "Start packing",
      "Finish packing",
    ]) {
      await row.getByRole("button", { name, exact: true }).click();
    }
    await expect(row).toContainText("PACKED");
  });
