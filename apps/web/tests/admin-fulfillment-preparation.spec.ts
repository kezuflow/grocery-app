import { expect, test, executeAdminE2eSql } from "./admin-authenticated-fixture";

test("Scheduled paid preparation handles shortage and stops at unreceived goods", async ({
  adminPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const orderId = `o-${id}`;
  executeAdminE2eSql(`
    INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,delivery_date,cutoff_at,status,capacity,allocated,version)
      VALUES ('${id}','market-metro-cebu','Preparation week',${now - 86400000},${now + 86400000},${now - 60000},'CUTOFF_REACHED',0,0,1);
    INSERT INTO user(id,name,email,email_verified,created_at,updated_at)
      VALUES ('u-${id}','Synthetic buyer','preparation-${id}@example.com',1,${now},${now});
    INSERT INTO customer(id,auth_user_id,status,created_at,updated_at)
      VALUES ('c-${id}','u-${id}','active',${now},${now});
    INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
      VALUES ('p-${id}','c-${id}',100,'PHP','SUCCEEDED','mock','p-${id}',${now},${now});
    INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at,committed_at,order_number)
      VALUES ('${orderId}','c-${id}','p-${id}','${id}','SCHEDULED','COMMITTED',100,'PHP','{"recipient":"Synthetic recipient","phone":"Phone withheld"}',${now},${now},'FM-PREP-${id.slice(0, 8)}');
    INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at)
      VALUES ('f-${id}','${orderId}','location-cebu-central','NOT_STARTED',1,${now});
    INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams)
      VALUES ('line-${id}','${orderId}','sku-red-onion-500g','Red onion','500 g','pack',1,100,100,500,'GRAM',500);
    INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at)
      VALUES ('d-${id}','${orderId}','${id}','location-cebu-central','pool-red-onion',500,'OPEN','EXACT_PAID_LINE','line-${id}','sku-red-onion-500g',1,500,'GRAM',500,${now});
  `);

  await page.goto(`/admin/fulfillment?orderId=${orderId}`);
  await page.getByRole("combobox", { name: "Active admin scope" }).click();
  await page.getByRole("option", { name: "Central Cebu", exact: true }).click();
  const detail = page.getByRole("complementary", { name: /Order .* details/ });
  await expect(detail.getByRole("heading", { name: "Ordered item checklist" })).toBeVisible();
  await expect(detail).toContainText("1 pack");

  const peer = await page.context().newPage();
  await peer.goto(`/admin/fulfillment?orderId=${orderId}`);
  await peer.getByRole("combobox", { name: "Active admin scope" }).click();
  await peer.getByRole("option", { name: "Central Cebu", exact: true }).click();
  const peerDetail = peer.getByRole("complementary", { name: /Order .* details/ });
  await expect(
    peerDetail.getByRole("button", { name: "Accept order & start picking" }),
  ).toBeVisible();

  await detail.getByRole("button", { name: "Accept order & start picking" }).click();
  await expect(detail.getByRole("button", { name: "Finish picking" })).toBeVisible();
  await expect(peerDetail.getByRole("button", { name: "Finish picking" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(peer.locator("[data-sonner-toast]")).toHaveCount(0);
  await peer.close();
  await detail
    .getByRole("textbox", { name: "Optional shortage reason" })
    .fill("One pack requires review");
  await detail.getByRole("button", { name: "Report shortage" }).click();
  await expect(detail.getByRole("button", { name: "Resume picking" })).toBeVisible();
  await detail.getByRole("button", { name: "Resume picking" }).click();
  await expect(detail.getByRole("button", { name: "Finish picking" })).toBeVisible();
  await detail.getByRole("button", { name: "Finish picking" }).click();
  await expect(detail.getByRole("button", { name: "Start packing" })).toBeVisible();
  await detail.getByRole("button", { name: "Start packing" }).click();
  await expect(detail.getByText("Packing blocked")).toBeVisible();
  await expect(
    detail.getByRole("link", { name: "Open receiving for this delivery week" }),
  ).toHaveAttribute("href", `/admin/receiving?cycleId=${id}`);
  await expect(detail.getByRole("button", { name: "Finish packing" })).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({
    path: testInfo.outputPath("fulfillment-preparation-blocked-1440.png"),
  });

  const current = await page.request.get(
    `/api/admin/fulfillment?locationId=location-cebu-central&orderId=${orderId}&limit=1`,
  );
  const currentResult = (await current.json()) as {
    ok: boolean;
    value?: { items: Array<{ status: string; version: number }> };
  };
  expect(currentResult).toMatchObject({ ok: true, value: { items: [{ status: "PACKING" }] } });
  const version = currentResult.value?.items[0]?.version;
  if (version === undefined) throw new Error("Missing current fulfillment version");

  const denied = await page.request.post("/api/admin/fulfillment", {
    data: {
      locationId: "location-cebu-central",
      orderId,
      action: "MARK_PACKED",
      expectedVersion: version,
    },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(await denied.json()).toMatchObject({
    ok: false,
    error: {
      code: "CONFLICT",
      message:
        "Scheduled goods are not fully received for this order. Review receiving before finishing packing.",
    },
  });
  await expect(detail).toContainText("Packing blocked");
});
