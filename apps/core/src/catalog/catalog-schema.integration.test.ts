import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

async function columns(table: string): Promise<string[]> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

async function tableExists(table: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(table)
    .first<{ name: string }>();
  return row?.name === table;
}

const CHILI_PRODUCT_ID = "schema-test-product-chili";
const CHILI_SKU_ID = "schema-test-sku-chili-pack";

async function seedChiliSku(): Promise<void> {
  // Storage persists across tests in this file, so clear prior seed rows
  // (children before parents) before reseeding deterministically.
  const cleanup = [
    env.DB.prepare("DELETE FROM sku_location_availability WHERE sku_id=?").bind(CHILI_SKU_ID),
    env.DB.prepare("DELETE FROM sku_detail WHERE sku_id=?").bind(CHILI_SKU_ID),
    env.DB.prepare("DELETE FROM sku WHERE id=?").bind(CHILI_SKU_ID),
    env.DB.prepare("DELETE FROM product WHERE id=?").bind(CHILI_PRODUCT_ID),
    env.DB.prepare("DELETE FROM inventory_pool WHERE id='schema-test-pool-chili'"),
  ];
  for (const statement of cleanup) await statement.run();
  const statements = [
    env.DB.prepare(
      "INSERT INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, canonical_sourcing_mode, created_at, updated_at) VALUES ('schema-test-pool-chili', ?, 'unit-gram', 'PLANNED_PROCUREMENT', 'PLANNED', 0, 0)",
    ).bind(CHILI_PRODUCT_ID),
    env.DB.prepare(
      "INSERT INTO product (id, category_id, inventory_pool_id, slug, name, description, status, created_at, updated_at) VALUES (?, 'category-fresh-produce', 'schema-test-pool-chili', 'schema-test-chili', 'Siling Labuyo', 'Fresh local chili peppers.', 'active', 0, 0)",
    ).bind(CHILI_PRODUCT_ID),
    env.DB.prepare(
      "INSERT INTO sku (id, product_id, code, name, sellable_unit_id, sell_quantity, consumption_base_quantity, merchandising_label, status, sort_order, version, created_at, updated_at) VALUES (?, ?, 'SCHEMA_TEST_CHILI_PACK', '1 pack', 'unit-gram', 100, 100, 'Pack', 'active', 1, 1, 0, 0)",
    ).bind(CHILI_SKU_ID, CHILI_PRODUCT_ID),
    env.DB.prepare(
      "INSERT INTO sku_detail (id, sku_id, audience, label, value, sort_order) VALUES ('schema-test-chili-customer', ?, 'CUSTOMER', 'Contents', 'Approximately 10–15 chili peppers per pack.', 1)",
    ).bind(CHILI_SKU_ID),
    env.DB.prepare(
      "INSERT INTO sku_detail (id, sku_id, audience, label, value, sort_order) VALUES ('schema-test-chili-operations', ?, 'OPERATIONS', 'Packing instruction', 'Pack 100 g per bag.', 1)",
    ).bind(CHILI_SKU_ID),
    env.DB.prepare(
      "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (?, 'location-cebu-central', 'AVAILABLE', 'PLANNED', 1)",
    ).bind(CHILI_SKU_ID),
  ];
  for (const statement of statements) await statement.run();
}

async function rejects(statement: ReturnType<typeof env.DB.prepare>): Promise<void> {
  let rejected = false;
  try {
    await statement.run();
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}

describe("catalog detail and SKU-availability schema", () => {
  beforeEach(seedChiliSku);

  it("adds SKU merchandising, sell-quantity, and version columns", async () => {
    expect(await columns("sku")).toEqual(
      expect.arrayContaining(["merchandising_label", "sell_quantity", "version"]),
    );
  });

  it("stores exact canonical unit conversions and lifecycle versions", async () => {
    expect(await columns("unit")).toEqual(
      expect.arrayContaining([
        "canonical_base_code",
        "conversion_numerator",
        "conversion_denominator",
        "status",
        "version",
      ]),
    );
    const kilogram = await env.DB.prepare(
      "SELECT canonical_base_code, conversion_numerator, conversion_denominator FROM unit WHERE id='unit-kilogram'",
    ).first<Record<string, unknown>>();
    expect(kilogram).toEqual({
      canonical_base_code: "GRAM",
      conversion_numerator: 1000,
      conversion_denominator: 1,
    });
    const volumeUnits = await env.DB.prepare(
      "SELECT code, canonical_base_code, conversion_numerator, conversion_denominator, status FROM unit WHERE dimension='VOLUME' ORDER BY code",
    ).all<Record<string, unknown>>();
    expect(volumeUnits.results).toEqual([
      {
        code: "LITER",
        canonical_base_code: "MILLILITER",
        conversion_numerator: 1000,
        conversion_denominator: 1,
        status: "active",
      },
      {
        code: "MILLILITER",
        canonical_base_code: "MILLILITER",
        conversion_numerator: 1,
        conversion_denominator: 1,
        status: "active",
      },
    ]);
    const invalidSourcing = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM inventory_pool WHERE canonical_sourcing_mode NOT IN ('STOCKED', 'PLANNED', 'ON_DEMAND', 'MIXED')",
    ).first<{ count: number }>();
    expect(invalidSourcing?.count).toBe(0);
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='ON_DEMAND' WHERE id='schema-test-pool-chili'",
    ).run();
    await rejects(
      env.DB.prepare(
        "UPDATE inventory_pool SET canonical_sourcing_mode='HYBRID' WHERE id='schema-test-pool-chili'",
      ),
    );
  });

  it("creates product detail, sku detail, and sku location availability tables", async () => {
    expect(await tableExists("product_detail")).toBe(true);
    expect(await tableExists("sku_detail")).toBe(true);
    expect(await tableExists("sku_location_availability")).toBe(true);
  });

  it("stores customer and operations SKU details separately from product details", async () => {
    const details = await env.DB.prepare(
      "SELECT audience, label, value FROM sku_detail WHERE sku_id=? ORDER BY sort_order",
    )
      .bind(CHILI_SKU_ID)
      .all<{ audience: string; label: string; value: string }>();
    expect(details.results.map((row) => row.audience)).toEqual(["CUSTOMER", "OPERATIONS"]);
    expect(await columns("product_detail")).toEqual(
      expect.arrayContaining(["product_id", "label", "value", "sort_order"]),
    );
  });

  it("marks the launch SKU available for Central Cebu without product-level dependence", async () => {
    const availability = await env.DB.prepare(
      "SELECT availability_status FROM sku_location_availability WHERE sku_id=? AND location_id='location-cebu-central'",
    )
      .bind(CHILI_SKU_ID)
      .first<{ availability_status: string }>();
    expect(availability?.availability_status).toBe("AVAILABLE");
  });

  it("rejects invalid rows through foreign keys and positive-quantity guards", async () => {
    await rejects(
      env.DB.prepare(
        "INSERT INTO product_detail (id, product_id, label, value, sort_order) VALUES ('schema-bad-detail', 'missing-product', 'Storage', 'x', 1)",
      ),
    );
    await rejects(
      env.DB.prepare(
        "INSERT INTO sku_detail (id, sku_id, audience, label, value, sort_order) VALUES ('schema-bad-audience', ?, 'CHEF', 'Note', 'x', 1)",
      ).bind(CHILI_SKU_ID),
    );
    await rejects(
      env.DB.prepare("UPDATE sku SET sell_quantity = 0 WHERE id = ?").bind(CHILI_SKU_ID),
    );
    await rejects(env.DB.prepare("UPDATE sku SET version = 0 WHERE id = ?").bind(CHILI_SKU_ID));
    await rejects(
      env.DB.prepare(
        "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (?, 'location-cebu-central', 'MAYBE', 'PLANNED', 1)",
      ).bind(CHILI_SKU_ID),
    );
    await rejects(
      env.DB.prepare(
        "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (?, 'location-cebu-central', 'AVAILABLE', 'BULK', 1)",
      ).bind(CHILI_SKU_ID),
    );
    await rejects(
      env.DB.prepare(
        "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES ('missing-sku', 'location-cebu-central', 'AVAILABLE', 'STOCKED', 1)",
      ),
    );
  });
});
