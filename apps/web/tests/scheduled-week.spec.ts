import { z } from "@freshmarkets/validation";
import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";
// Synthetic committed-payment/cycle history is a fixture seam, not provider or no-SQL checkout acceptance.
// Week reads, purchase confirmation, replay and receiving use the real Web/Core/D1 path.
for (const width of [1440, 390])
  test(`Delivery week purchase to receiving at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    test.setTimeout(90000);
    const id = crypto.randomUUID(),
      name = `Delivery week ${width} ${id.slice(0, 6)}`,
      now = Date.now();
    executeAdminE2eSql(`
    INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,delivery_date,cutoff_at,status,capacity,allocated,version)
      VALUES ('${id}','market-metro-cebu','${name}',${now - 86400000},${now + 86400000},${now - 60000},'CUTOFF_REACHED',0,0,1);
    INSERT INTO delivery_cycle_schedule(cycle_id,timezone,procurement_at,preparation_at,pickup_at,created_at,updated_at)
      VALUES ('${id}','Asia/Manila',${now},${now + 3600000},${now + 7200000},${now},${now});
    INSERT INTO delivery_cycle_window(id,cycle_id,name,starts_at,ends_at,created_at)
      VALUES ('window-${id}','${id}','Afternoon',${now + 10800000},${now + 14400000},${now});
    INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('u-${id}','Synthetic buyer','week-${id}@example.com',1,${now},${now});
    INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES ('c-${id}','u-${id}','active',${now},${now});
    INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
      VALUES ('p-${id}','c-${id}',20000,'PHP','SUCCEEDED','mock','p-${id}',${now},${now});
    INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at)
      VALUES ('o-${id}','c-${id}','p-${id}','${id}','SCHEDULED','COMMITTED',20000,'PHP','{}',${now});
    INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams)
      VALUES ('i-${id}','o-${id}','sku-red-onion-500g','Red onion','500 g','GRAM',2,10000,20000,1000,'GRAM',1000);
    INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at)
      VALUES ('d-${id}','o-${id}','${id}','location-cebu-central','pool-red-onion',1000,'OPEN','EXACT_PAID_LINE','i-${id}','sku-red-onion-500g',2,1000,'GRAM',1000,${now});
  `);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/procurement");
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(id);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const demand = page.getByRole("article").filter({ hasText: "Red onion" });
    await expect(demand).toContainText("2 sold units · 1,000 g");
    const attempts: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/procurement/purchase", async (route) => {
      attempts.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (attempts.length > 1) return route.continue();
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort("failed");
    });
    await demand.getByRole("button", { name: "Confirm purchase", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await sheet
      .getByLabel("Purchase note (optional)")
      .fill("Synthetic supplier purchase reference");
    await sheet.getByRole("button", { name: "Confirm purchase", exact: true }).click();
    await expect(
      sheet.getByText("The action could not be confirmed.", { exact: false }),
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Confirm purchase", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await expect(demand).toContainText("ordered");
    await expect(demand.getByRole("button", { name: "Confirm purchase", exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Paid orders", exact: true }).click();
    await expect(page.getByRole("link", { name: "View order 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Offered products", exact: true }).click();
    await expect(
      page.getByText("Currently enabled selling options", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Quantities to buy", exact: true }).click();
    await expect(demand).toContainText("ordered");
    await page.screenshot({
      path: testInfo.outputPath(`scheduled-week-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("link", { name: "Receiving", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`cycleId=${id}`));
    const row = page.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: "Start receiving", exact: true }).click();
    const parsed = z
      .object({
        ok: z.literal(true),
        value: z.object({ items: z.array(z.object({ receivingSessionId: z.string() })) }),
      })
      .parse(
        await (
          await page.request.get(
            `/api/admin/receiving?locationId=location-cebu-central&cycleId=${id}`,
          )
        ).json(),
      );
    const receipt = parsed.value.items[0];
    if (!receipt) throw new Error("Missing purchase receipt");
    await row
      .getByLabel(`Accepted quantity ${receipt.receivingSessionId}`, { exact: true })
      .fill("1000");
    await row
      .getByLabel(`Rejected quantity ${receipt.receivingSessionId}`, { exact: true })
      .fill("0");
    await row
      .getByLabel(`Receiving reason ${receipt.receivingSessionId}`, { exact: true })
      .fill("Inspected supplier goods");
    await row.getByRole("button", { name: "Record line", exact: true }).click();
    await expect(row).toContainText("1000 / 0");
    await page.goto("/admin/procurement");
    await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(id);
    await expect(demand).toContainText("Accepted 1,000 g");
    await page.screenshot({
      path: testInfo.outputPath(`scheduled-week-received-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
