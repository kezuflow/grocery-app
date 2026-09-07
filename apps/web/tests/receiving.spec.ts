import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";
// Purchased requirement is a test precondition. This is receipt-browser acceptance,
// not evidence for the still-separate demand-to-purchase or provider journey.
for (const width of [1440, 390])
  test(`Receive and resolve inspected Scheduled goods at ${width}px`, async ({
    adminPage: page,
  }, testInfo) => {
    const id = crypto.randomUUID(),
      name = `Inspected receipt ${width} ${id.slice(0, 8)}`;
    executeAdminE2eSql(`
    INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,delivery_date,cutoff_at,status,capacity,allocated,version)
      SELECT '${id}',market_id,'${name}',order_opens_at,delivery_date,cutoff_at,status,capacity,allocated,1 FROM delivery_cycle WHERE id='cycle-next-cebu';
    INSERT INTO procurement_requirement(id,delivery_cycle_id,location_id,inventory_pool_id,required_quantity,status,version)
      VALUES ('${id}','${id}','location-cebu-central','pool-red-onion',1000,'ORDERED',1);
    INSERT INTO receiving_record(id,procurement_requirement_id,expected_quantity,accepted_quantity,rejected_quantity,status,version)
      VALUES ('${id}','${id}',1000,0,0,'NOT_STARTED',1);
  `);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/receiving");
    await page.getByRole("combobox", { name: "Active admin scope" }).click();
    await page
      .getByRole("option", { name: /Central/ })
      .first()
      .click();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Red onion");
    await row.getByRole("button", { name: "Start receiving", exact: true }).click();
    await expect(row.getByRole("button", { name: "Record line", exact: true })).toBeVisible();
    await row.getByLabel(`Accepted quantity ${id}`, { exact: true }).fill("900");
    await row.getByLabel(`Rejected quantity ${id}`, { exact: true }).fill("100");
    await row
      .getByLabel(`Receiving reason ${id}`, { exact: true })
      .fill("Inspected; damaged goods rejected");
    await row.getByRole("button", { name: "Record line", exact: true }).click();
    await expect(row).toContainText("DISCREPANCY");
    await expect(row).toContainText("900 / 100");
    await row.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(row).toContainText("COMPLETED");
    await page.reload();
    await expect(row).toContainText("900 / 100");
    await expect(row.getByRole("button", { name: "Complete", exact: true })).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("receiving.png"), fullPage: true });
  });
