import { z } from "@freshmarkets/validation";
import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";
// Synthetic committed-payment/cycle history is a fixture seam, not provider or no-SQL checkout acceptance.
// Pending/failure history below is a fixture seam; signed provider closure is tested in Core.
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
    INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at)
      VALUES ('pending-${id}','ORDER_AMENDMENT','paid_order_amendment','pending-${id}','c-${id}',100,'PHP','PROCESSING','pending-${id}',${now},${now});
    INSERT INTO paid_order_amendment(id,order_id,status,currency,total_minor,payment_intent_id,idempotency_key,created_at,updated_at)
      VALUES ('pending-${id}','o-${id}','PENDING_PAYMENT','PHP',100,'pending-${id}','pending-${id}',${now},${now});
  `);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/procurement");
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
    await page.getByRole("combobox", { name: "Delivery week", exact: true }).selectOption(id);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const demand = page.getByRole("article").filter({ hasText: "Red onion" });
    await expect(demand).toContainText("2 sold units · 1,000 g");
    const pending = page.getByText("Payments for this week are still being confirmed.", {
      exact: false,
    });
    await expect(pending).toBeVisible();
    await expect(demand.getByRole("button", { name: "Confirm purchase", exact: true })).toHaveCount(
      0,
    );
    await page.screenshot({
      path: testInfo.outputPath(`scheduled-week-pending-${width}.png`),
      fullPage: true,
    });
    executeAdminE2eSql(
      `UPDATE payment_intent SET status='FAILED',version=version+1 WHERE id='pending-${id}'`,
    );
    await expect(pending).toHaveCount(0, { timeout: 15000 });
    await expect(
      demand.getByRole("button", { name: "Confirm purchase", exact: true }),
    ).toBeVisible();
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
      .fill("700");
    await row
      .getByLabel(`Rejected quantity ${receipt.receivingSessionId}`, { exact: true })
      .fill("100");
    await row
      .getByLabel(`Missing quantity ${receipt.receivingSessionId}`, { exact: true })
      .fill("200");
    await row
      .getByLabel(`Receiving reason ${receipt.receivingSessionId}`, { exact: true })
      .fill("Inspected supplier goods");
    await row.getByRole("button", { name: "Record line", exact: true }).click();
    await expect(row).toContainText("700 / 100");
    await expect(row).toContainText("Missing: 200");
    const replacements: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/receiving/record-line", async (route) => {
      replacements.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (replacements.length > 1) return route.continue();
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      await route.abort("failed");
    });
    await row
      .getByLabel(`Accepted quantity ${receipt.receivingSessionId}`, { exact: true })
      .fill("300");
    await row
      .getByLabel(`Receiving reason ${receipt.receivingSessionId}`, { exact: true })
      .fill("Inspected replacement goods received from supplier");
    await row.getByRole("button", { name: "Receive replacement", exact: true }).click();
    await expect(
      page.getByText("The receiving result is unknown.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry saved receipt", exact: true }).click();
    await expect(row).toContainText("1000 / 100");
    await expect(row).toContainText("Replacements accepted: 300");
    expect(replacements).toHaveLength(2);
    expect(replacements[1]).toEqual(replacements[0]);
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
    // Attach synthetic canonical payment history, then release demand through the real
    // Admin cancellation command. This does not assert provider refund acceptance.
    executeAdminE2eSql(`
      INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at)
        VALUES ('intent-${id}','GROCERY_CHECKOUT','checkout_quote','quote-${id}','c-${id}',20000,'PHP','SUCCEEDED','intent-${id}',${now},${now});
      UPDATE payment_attempt SET payment_intent_id='intent-${id}' WHERE id='p-${id}';
      INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at)
        VALUES ('paid-${id}','intent-${id}','reaction-${id}','o-${id}',${now});`);
    expect(
      await (
        await page.request.post(`/api/admin/orders/o-${id}/cancel`, {
          headers: { "idempotency-key": crypto.randomUUID() },
          data: { expectedVersion: 1, reason: "Operational failure; inspect unused goods" },
        })
      ).json(),
    ).toMatchObject({ ok: true });
    await page.getByRole("link", { name: "Receiving", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`cycleId=${id}`));
    const leftovers = page
      .getByRole("region", { name: "Unused received goods" })
      .getByRole("article")
      .filter({ hasText: name });
    await expect(leftovers).toContainText("1,000 g unused");
    await expect(leftovers).toContainText("Red onion");
    await leftovers.getByRole("button", { name: "Release inspected surplus", exact: true }).click();
    const release = page.getByRole("dialog");
    await release.getByLabel("Quantity to release (g)", { exact: true }).fill("400");
    await release.getByLabel("Reason", { exact: true }).fill("Inspected after Order cancellation");
    await release.getByLabel("I inspected these goods and they are suitable for sale.").check();
    const releases: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/admin/receiving/surplus", async (route) => {
      releases.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (releases.length > 1) return route.continue();
      expect(await (await route.fetch()).json()).toMatchObject({ ok: true });
      await route.abort("failed");
    });
    await release.getByRole("button", { name: "Release to stock", exact: true }).click();
    await expect(
      release.getByText("The action could not be confirmed.", { exact: false }),
    ).toBeVisible();
    await release.getByRole("button", { name: "Release to stock", exact: true }).click();
    await expect(release).toHaveCount(0);
    expect(releases).toHaveLength(2);
    expect(releases[1]).toEqual(releases[0]);
    await expect(leftovers).toContainText("600 g unused · 400 g released to stock");
    await page.screenshot({
      path: testInfo.outputPath(`scheduled-surplus-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
