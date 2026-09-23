import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";

test("Central Cebu explains why a Scheduled order cannot finish packing", async ({ adminPage }) => {
  const id = crypto.randomUUID();
  const now = Date.now();
  executeAdminE2eSql(`
    INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,delivery_date,cutoff_at,status,capacity,allocated,version)
      VALUES ('${id}','market-metro-cebu','Packing blocker week',${now - 86400000},${now + 86400000},${now - 60000},'CUTOFF_REACHED',0,0,1);
    INSERT INTO user(id,name,email,email_verified,created_at,updated_at)
      VALUES ('u-${id}','Synthetic buyer','packing-${id}@example.com',1,${now},${now});
    INSERT INTO customer(id,auth_user_id,status,created_at,updated_at)
      VALUES ('c-${id}','u-${id}','active',${now},${now});
    INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
      VALUES ('p-${id}','c-${id}',100,'PHP','SUCCEEDED','mock','p-${id}',${now},${now});
    INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at)
      VALUES ('o-${id}','c-${id}','p-${id}','${id}','SCHEDULED','FULFILLMENT_PENDING',100,'PHP','{}',${now});
    INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at)
      VALUES ('f-${id}','o-${id}','location-cebu-central','PACKING',4,${now});
    INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams)
      VALUES ('line-${id}','o-${id}','sku-red-onion-500g','Red onion','500 g','pack',1,100,100,500,'GRAM',500);
    INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at)
      VALUES ('d-${id}','o-${id}','${id}','location-cebu-central','pool-red-onion',500,'OPEN','EXACT_PAID_LINE','line-${id}','sku-red-onion-500g',1,500,'GRAM',500,${now});
  `);
  await adminPage.goto("/admin/fulfillment");
  await adminPage.getByRole("combobox", { name: "Active admin scope" }).click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  await expect(adminPage.getByRole("row").filter({ hasText: `o-${id}` })).toContainText(
    "Record received goods",
  );
  await expect(
    adminPage.getByText("Goods for this delivery week are not fully recorded as received.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(adminPage.getByText("no receipt recorded", { exact: false })).toBeVisible();
  await expect(
    adminPage.getByRole("link", { name: "Open receiving for this delivery week" }),
  ).toHaveAttribute("href", `/admin/receiving?cycleId=${id}`);
  await expect(adminPage.getByRole("button", { name: "Finish packing" })).toHaveCount(0);
});
