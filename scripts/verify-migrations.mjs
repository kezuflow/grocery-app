import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const migrationDirectory = join(process.cwd(), "apps", "core", "migrations");
const migrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationDirectory, name), "utf8") }));

function database() {
  const value = new DatabaseSync(":memory:");
  value.exec("PRAGMA foreign_keys=ON");
  return value;
}

function apply(database, selected) {
  for (const migration of selected) {
    database.exec("BEGIN; PRAGMA defer_foreign_keys=ON;");
    try {
      database.exec(migration.sql);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`${migration.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function assertFinalSchema(database) {
  const indexes = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('checkout_quote','grocery_order')",
    )
    .all()
    .map((row) => row.name);
  for (const name of [
    "checkout_quote_cart_idx",
    "checkout_quote_expiry_idx",
    "grocery_order_customer_idx",
    "grocery_order_payment_unique",
  ])
    assert.ok(indexes.includes(name), `missing index ${name}`);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.ok(
    database
      .prepare("PRAGMA table_info(checkout_quote)")
      .all()
      .some((column) => column.name === "delivery_fee_snapshot_json"),
  );
  assert.ok(
    database
      .prepare("PRAGMA table_info(order_fulfillment_snapshot)")
      .all()
      .some((column) => column.name === "delivery_fee_snapshot_json"),
  );

  // Catalog detail/availability storage (migration 0024).
  for (const table of ["product_detail", "sku_detail", "sku_location_availability"])
    assert.ok(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table),
      `missing catalog table ${table}`,
    );
  const skuColumns = database
    .prepare("PRAGMA table_info(sku)")
    .all()
    .map((column) => column.name);
  for (const column of ["merchandising_label", "sell_quantity", "version"])
    assert.ok(skuColumns.includes(column), `missing sku column ${column}`);
  // Every active SKU of a product with product-level Cebu availability was
  // backfilled into SKU-level availability.
  const missingBackfill = database
    .prepare(
      `SELECT COUNT(*) AS count FROM sku s
       JOIN location_product_availability lpa ON lpa.product_id = s.product_id
       WHERE s.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM sku_location_availability sla
           WHERE sla.sku_id = s.id AND sla.location_id = lpa.location_id
         )`,
    )
    .get().count;
  assert.equal(missingBackfill, 0, "sku_location_availability backfill missed active SKUs");
  assert.ok(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM sku_location_availability WHERE location_id = 'location-cebu-central'",
      )
      .get().count > 0,
    "expected Cebu Central SKU availability rows",
  );
}

/** Produce launch acceptance (migrations through 0025). */
function assertProduceLaunch(database) {
  const assetDir = join(process.cwd(), "apps", "web", "public", "produce");
  const publicAssets = new Set(
    readdirSync(assetDir)
      .filter((name) => name.endsWith(".webp"))
      .sort(),
  );
  const mediaRows = database
    .prepare("SELECT id, image_metadata_json FROM product WHERE image_metadata_json IS NOT NULL")
    .all();
  const assetKeys = new Set();
  for (const row of mediaRows) {
    const media = JSON.parse(row.image_metadata_json);
    assert.equal(media.version, 1, `product ${row.id} media requires version 1`);
    assert.match(media.assetKey, /\.webp$/, `product ${row.id} media asset key must be .webp`);
    assert.ok(media.altText && media.altText.length > 0, `product ${row.id} needs alt text`);
    assetKeys.add(media.assetKey);
  }
  assert.equal(assetKeys.size, 226, "expected 226 distinct produce asset mappings");
  for (const asset of publicAssets)
    assert.ok(assetKeys.has(asset), `public asset ${asset} has no product mapping`);
  assert.equal(assetKeys.size, publicAssets.size, "unexpected extra media assets");

  // Every active SKU of a mapped product is available in Cebu Central and
  // carries an open positive Metro Cebu standard price.
  const violations = database
    .prepare(
      `SELECT s.id FROM sku s
       JOIN product p ON p.id = s.product_id AND p.image_metadata_json IS NOT NULL
       WHERE s.status = 'active'
         AND (
           NOT EXISTS (
             SELECT 1 FROM sku_location_availability sla
             WHERE sla.sku_id = s.id
               AND sla.location_id = 'location-cebu-central'
               AND sla.availability_status = 'AVAILABLE'
           )
           OR NOT EXISTS (
             SELECT 1 FROM price_version pv
             WHERE pv.sku_id = s.id
               AND pv.market_id = 'market-metro-cebu'
               AND pv.price_type = 'STANDARD'
               AND pv.amount_minor > 0
               AND pv.valid_to IS NULL
           )
         )`,
    )
    .all();
  assert.deepEqual(violations, [], "launch SKUs missing availability or open Cebu price");

  // Retired variant combinations on reused products are deactivated, not deleted.
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM sku WHERE product_id='product-papaya' AND status='inactive'",
      )
      .get().count,
    3,
    "expected retired papaya weight SKUs deactivated",
  );
}

const fresh = database();
apply(fresh, migrations);
assertFinalSchema(fresh);
assertProduceLaunch(fresh);
fresh.close();

const populated = database();
apply(
  populated,
  migrations.filter((migration) => migration.name <= "0021_instant_mode.sql"),
);
populated.exec(`
  INSERT INTO customer (id, auth_user_id, status, created_at, updated_at)
    VALUES ('upgrade-customer', 'upgrade-auth', 'active', 1, 1);
  INSERT INTO customer_address
    (id, customer_id, label, recipient, phone, address_json, latitude, longitude, status, version, created_at, updated_at)
    VALUES ('upgrade-address', 'upgrade-customer', 'Home', 'Recipient', '09', '{}', 10.32, 123.9, 'active', 1, 1, 1);
  INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at)
    VALUES ('upgrade-cart', 'upgrade-customer', 'location-cebu-central', 'ACTIVE', 1, 1, 1);
  INSERT INTO cart_item (cart_id, sku_id, quantity)
    VALUES ('upgrade-cart', 'sku-red-onion-500g', 1);
  INSERT INTO checkout_attempts
    (id, customer_id, cart_id, address_id, cycle_id, zone_id, location_id, quote_version, status, idempotency_key, expires_at, version, created_at, updated_at)
    VALUES ('upgrade-attempt', 'upgrade-customer', 'upgrade-cart', 'upgrade-address', 'cycle-next-cebu', 'zone-cebu-city-core', 'location-cebu-central', 1, 'PROCESSING', 'upgrade-attempt-key', 9999999999999, 1, 1, 1);
  INSERT INTO checkout_quote
    (id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, lines_json, address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json, status, version, expires_at, idempotency_key, created_at, updated_at)
    VALUES ('upgrade-quote', 'upgrade-quote-attempt', 'upgrade-customer', 'upgrade-cart', 'upgrade-address', 'cycle-next-cebu', 'PHP', 100, 0, 50, 150, '[]', '{}', '{}', '{}', 'ACTIVE', 1, 9999999999999, 'upgrade-quote-key', 1, 1);
  INSERT INTO payment_attempt
    (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at, version)
    VALUES ('upgrade-payment', 'upgrade-customer', 150, 'PHP', 'SUCCEEDED', 'mock', 'upgrade-payment-key', 1, 1, 1);
  INSERT INTO grocery_order
    (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version)
    VALUES ('upgrade-order', 'upgrade-customer', 'cycle-next-cebu', '{}', 'COMMITTED', 150, 'PHP', 'upgrade-payment', 1, 1);
  INSERT INTO order_item
    (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity)
    VALUES ('upgrade-item', 'upgrade-order', 'sku-red-onion-500g', 'Onion', '500g', 'unit-gram', 1, 100, 100, 500);
  INSERT INTO order_fulfillment_snapshot
    (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, fulfillment_mode, sourcing_modes_json, created_at)
    VALUES ('upgrade-order', 'location-cebu-central', 'cycle-next-cebu', 'zone-cebu-city-core', 1, 2, 'SCHEDULED', '[]', 1);
  INSERT INTO fulfillment_record (id, order_id, location_id, status, updated_at, version)
    VALUES ('upgrade-fulfillment', 'upgrade-order', 'location-cebu-central', 'PENDING', 1, 1);
  INSERT INTO delivery_job
    (id, order_id, cycle_id, rider_user_id, status, address_snapshot_json, delivered_at, version)
    VALUES ('upgrade-job', 'upgrade-order', 'cycle-next-cebu', NULL, 'PENDING', '{}', NULL, 1);
`);
apply(
  populated,
  migrations.filter((migration) => migration.name > "0021_instant_mode.sql"),
);
assertFinalSchema(populated);
assertProduceLaunch(populated);
assert.equal(
  populated.prepare("SELECT fulfillment_mode FROM grocery_order WHERE id='upgrade-order'").get()
    .fulfillment_mode,
  "SCHEDULED",
);
assert.equal(populated.prepare("SELECT COUNT(*) AS count FROM order_item").get().count, 1);
assert.throws(() =>
  populated.exec(
    "INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) VALUES ('invalid-item', 'missing-order', 'sku-red-onion-500g', 'Onion', '500g', 'unit-gram', 1, 100, 100, 500)",
  ),
);
assert.throws(() =>
  populated.exec(
    "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, version, created_at) VALUES ('duplicate-payment-order', 'upgrade-customer', 'cycle-next-cebu', 'SCHEDULED', '{}', 'COMMITTED', 150, 'PHP', 'upgrade-payment', 1, 2)",
  ),
);
populated.close();

console.log("Migrations verified: fresh apply and populated 0021 -> 0022 upgrade are valid.");
