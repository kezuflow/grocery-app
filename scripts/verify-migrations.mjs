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
      database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
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
  assert.deepEqual(
    database
      .prepare(
        "SELECT code, canonical_base_code, conversion_numerator, conversion_denominator FROM unit WHERE dimension='VOLUME' ORDER BY code",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        code: "LITER",
        canonical_base_code: "MILLILITER",
        conversion_numerator: 1000,
        conversion_denominator: 1,
      },
      {
        code: "MILLILITER",
        canonical_base_code: "MILLILITER",
        conversion_numerator: 1,
        conversion_denominator: 1,
      },
    ],
    "canonical volume units are incomplete",
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

function commerceUpgradeSnapshot(database) {
  const one = (sql) => ({ ...database.prepare(sql).get() });
  return {
    checkoutAttempt: one(
      `SELECT id, customer_id, cart_id, address_id, cycle_id, zone_id, location_id,
              quote_version, status, idempotency_key, expires_at, version, created_at, updated_at
       FROM checkout_attempts WHERE id='upgrade-attempt'`,
    ),
    checkoutQuoteSnapshot: one(
      `SELECT id, checkout_attempt_id, merchandise_minor, delivery_fee_minor,
              discount_minor, total_minor, currency, item_snapshot_json,
              eligibility_snapshot_json, created_at
       FROM checkout_quote_snapshots WHERE id='upgrade-quote-snapshot'`,
    ),
    checkoutInventoryHold: one(
      `SELECT id, checkout_attempt_id, inventory_pool_id, location_id, quantity,
              status, created_at, updated_at
       FROM checkout_inventory_holds WHERE id='upgrade-hold'`,
    ),
    order: one(
      `SELECT id, customer_id, cycle_id, address_snapshot_json, status, total_minor,
              currency, payment_id, created_at, version
       FROM grocery_order WHERE id='upgrade-order'`,
    ),
    orderItem: one(
      `SELECT id, order_id, sku_id, product_name_snapshot, variant_name_snapshot,
              unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity
       FROM order_item WHERE id='upgrade-item'`,
    ),
    inventoryReservation: one(
      `SELECT id, order_id, location_id, inventory_pool_id, quantity, status
       FROM inventory_reservation WHERE id='upgrade-reservation'`,
    ),
    committedDemand: one(
      `SELECT id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status
       FROM committed_demand WHERE id='upgrade-demand'`,
    ),
    fulfillmentRecord: one(
      `SELECT id, order_id, location_id, status, updated_at, version
       FROM fulfillment_record WHERE id='upgrade-fulfillment'`,
    ),
    deliveryJob: one(
      `SELECT id, order_id, cycle_id, rider_user_id, status, address_snapshot_json,
              delivered_at, version
       FROM delivery_job WHERE id='upgrade-job'`,
    ),
    deliveryStop: one(
      `SELECT id, batch_id, delivery_job_id, sequence, status, proof_json
       FROM delivery_stop WHERE id='upgrade-stop'`,
    ),
    legacyRefund: one(
      `SELECT id, payment_id, order_id, amount_minor, currency, status, reason,
              created_at, updated_at
       FROM refund WHERE id='upgrade-legacy-refund'`,
    ),
    legacyAmendment: one(
      `SELECT id, order_id, payment_id, total_minor, currency, status, created_at
       FROM order_amendment WHERE id='upgrade-legacy-amendment'`,
    ),
    paidAmendment: one(
      `SELECT id, order_id, status, currency, total_minor, payment_intent_id,
              idempotency_key, created_at, updated_at
       FROM paid_order_amendment WHERE id='upgrade-paid-amendment'`,
    ),
    paidAmendmentLine: one(
      `SELECT id, amendment_id, sku_id, product_name_snapshot, variant_name_snapshot,
              unit_snapshot, quantity, base_quantity, unit_price_minor,
              line_total_minor, created_at
       FROM paid_order_amendment_line WHERE id='upgrade-paid-amendment-line'`,
    ),
    inventoryReserved: one(
      `SELECT reserved FROM inventory_balance
       WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'`,
    ),
  };
}

const fresh = database();
apply(fresh, migrations);
assertFinalSchema(fresh);
assertProduceLaunch(fresh);
fresh.close();

const populated = database();
apply(
  populated,
  migrations.filter((migration) => migration.name <= "0020_email_auth.sql"),
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
  INSERT INTO checkout_quote_snapshots
    (id, checkout_attempt_id, merchandise_minor, delivery_fee_minor, discount_minor, total_minor, currency, item_snapshot_json, eligibility_snapshot_json, created_at)
    VALUES ('upgrade-quote-snapshot', 'upgrade-attempt', 100, 50, 0, 150, 'PHP', '[]', '{}', 1);
  INSERT INTO checkout_inventory_holds
    (id, checkout_attempt_id, inventory_pool_id, location_id, quantity, status, created_at, updated_at)
    VALUES ('upgrade-hold', 'upgrade-attempt', 'pool-red-onion', 'location-cebu-central', 500, 'HELD', 1, 1);
  INSERT INTO payment_attempt
    (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at, version)
    VALUES ('upgrade-payment', 'upgrade-customer', 150, 'PHP', 'SUCCEEDED', 'mock', 'upgrade-payment-key', 1, 1, 1);
  INSERT INTO grocery_order
    (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version)
    VALUES ('upgrade-order', 'upgrade-customer', 'cycle-next-cebu', '{}', 'COMMITTED', 150, 'PHP', 'upgrade-payment', 1, 1);
  INSERT INTO order_item
    (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity)
    VALUES ('upgrade-item', 'upgrade-order', 'sku-red-onion-500g', 'Onion', '500g', 'unit-gram', 1, 100, 100, 500);
  INSERT INTO inventory_reservation
    (id, order_id, location_id, inventory_pool_id, quantity, status)
    VALUES ('upgrade-reservation', 'upgrade-order', 'location-cebu-central', 'pool-red-onion', 500, 'COMMITTED');
  INSERT INTO committed_demand
    (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status)
    VALUES ('upgrade-demand', 'upgrade-order', 'cycle-next-cebu', 'location-cebu-central', 'pool-red-onion', 500, 'COMMITTED');
  INSERT INTO order_fulfillment_snapshot
    (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, fulfillment_mode, sourcing_modes_json, created_at)
    VALUES ('upgrade-order', 'location-cebu-central', 'cycle-next-cebu', 'zone-cebu-city-core', 1, 2, 'SCHEDULED', '[]', 1);
  INSERT INTO fulfillment_record (id, order_id, location_id, status, updated_at, version)
    VALUES ('upgrade-fulfillment', 'upgrade-order', 'location-cebu-central', 'PENDING', 1, 1);
  INSERT INTO delivery_job
    (id, order_id, cycle_id, rider_user_id, status, address_snapshot_json, delivered_at, version)
    VALUES ('upgrade-job', 'upgrade-order', 'cycle-next-cebu', NULL, 'PENDING', '{}', NULL, 1);
  INSERT INTO delivery_batch (id, cycle_id, status, rider_user_id, created_at)
    VALUES ('upgrade-batch', 'cycle-next-cebu', 'PLANNED', NULL, 1);
  INSERT INTO delivery_stop
    (id, batch_id, delivery_job_id, sequence, status, proof_json)
    VALUES ('upgrade-stop', 'upgrade-batch', 'upgrade-job', 1, 'PENDING', '{}');
  INSERT INTO refund
    (id, payment_id, order_id, amount_minor, currency, status, reason, created_at, updated_at)
    VALUES ('upgrade-legacy-refund', 'upgrade-payment', 'upgrade-order', 10, 'PHP', 'REQUESTED', 'test', 1, 1);
  INSERT INTO order_amendment
    (id, order_id, payment_id, total_minor, currency, status, created_at)
    VALUES ('upgrade-legacy-amendment', 'upgrade-order', 'upgrade-payment', 25, 'PHP', 'COMMITTED', 1);
  INSERT INTO paid_order_amendment
    (id, order_id, status, currency, total_minor, payment_intent_id, idempotency_key, created_at, updated_at)
    VALUES ('upgrade-paid-amendment', 'upgrade-order', 'DRAFT', 'PHP', 25, NULL, 'upgrade-amendment-key', 1, 1);
  INSERT INTO paid_order_amendment_line
    (id, amendment_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, base_quantity, unit_price_minor, line_total_minor, created_at)
    VALUES ('upgrade-paid-amendment-line', 'upgrade-paid-amendment', 'sku-red-onion-500g', 'Onion', '500g', 'unit-gram', 1, 500, 25, 25, 1);
`);
const expectedCommerceGraph = commerceUpgradeSnapshot(populated);
apply(
  populated,
  migrations.filter((migration) => migration.name === "0021_instant_mode.sql"),
);
assert.deepEqual(
  commerceUpgradeSnapshot(populated),
  expectedCommerceGraph,
  "0021 must preserve the populated checkout/order dependency graph",
);
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
assert.deepEqual(
  {
    ...populated
      .prepare(
        `SELECT address_json, address_components_json, barangay, city, postal_code,
                geocode_provider, geocode_reference, confirmation_source,
                user_confirmed_at, delivery_instructions_json
         FROM customer_address WHERE id='upgrade-address'`,
      )
      .get(),
  },
  {
    address_json: "{}",
    address_components_json: null,
    barangay: null,
    city: null,
    postal_code: null,
    geocode_provider: null,
    geocode_reference: null,
    confirmation_source: null,
    user_confirmed_at: null,
    delivery_instructions_json: null,
  },
  "0042 must preserve legacy addresses with nullable structured confirmation metadata",
);
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

// A deployed database may already have the original 0032 table and seed rows.
// Verify that 0033, rather than a rewritten historical migration, applies the
// Analytics metadata and immutable-publication guard additively.
const analyticsUpgrade = database();
apply(
  analyticsUpgrade,
  migrations.filter((migration) => migration.name <= "0032_analytics_definitions.sql"),
);
const legacyMetricColumns = analyticsUpgrade
  .prepare("PRAGMA table_info(metric_definitions)")
  .all()
  .map((column) => column.name);
assert.equal(legacyMetricColumns.includes("dimensions_json"), false);
assert.equal(legacyMetricColumns.includes("unavailable_reason"), false);
assert.equal(
  analyticsUpgrade.prepare("SELECT COUNT(*) AS count FROM metric_definitions").get().count,
  30,
  "original 0032 must seed the complete metric catalog",
);
apply(
  analyticsUpgrade,
  migrations.filter((migration) => migration.name === "0033_analytics_definition_guards.sql"),
);
const upgradedMetricColumns = analyticsUpgrade
  .prepare("PRAGMA table_info(metric_definitions)")
  .all()
  .map((column) => column.name);
assert.ok(upgradedMetricColumns.includes("dimensions_json"));
assert.ok(upgradedMetricColumns.includes("unavailable_reason"));
assert.deepEqual(
  {
    ...analyticsUpgrade
      .prepare(
        "SELECT dimensions_json, unavailable_reason, inclusion_json FROM metric_definitions WHERE code='gmv'",
      )
      .get(),
  },
  {
    dimensions_json: '["marketId","locationId","currency"]',
    unavailable_reason:
      "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
    inclusion_json: "{}",
  },
  "0033 must backfill the persisted blocked-metric metadata",
);
assert.deepEqual(
  {
    ...analyticsUpgrade
      .prepare("SELECT inclusion_json FROM metric_definitions WHERE code='order_count'")
      .get(),
  },
  { inclusion_json: '{"event":"first_successful_commitment"}' },
  "0033 must correct first-commitment semantics without rewriting 0032",
);
assert.throws(
  () =>
    analyticsUpgrade.exec(
      "UPDATE metric_definitions SET display_name='Changed' WHERE code='order_count'",
    ),
  /immutable/,
);
assert.throws(
  () =>
    analyticsUpgrade.exec(
      `INSERT INTO metric_definitions (
      id, code, version, display_name, category, formula_json, source_contract_version,
      event_time_field, reporting_timezone_policy, dimensions_json, inclusion_json,
      exclusion_json, rounding_policy, status, unavailable_reason, approved_at
    ) SELECT
      'metric-definition-order-count-v2', code, 2, display_name, category, formula_json,
      source_contract_version, event_time_field, reporting_timezone_policy, dimensions_json,
      inclusion_json, exclusion_json, rounding_policy, 'APPROVED', NULL, approved_at
    FROM metric_definitions WHERE code='order_count'`,
    ),
  /UNIQUE/,
);
analyticsUpgrade.close();

// A live database can contain duplicate ACTIVE carts because the historical
// schema had only a non-unique customer/status index. Verify the 0046
// reconciliation chooses the newest cart, preserves/merges lines, records safe
// evidence, and only then establishes the uniqueness invariant.
const cartUpgrade = database();
apply(
  cartUpgrade,
  migrations.filter((migration) => migration.name <= "0045_finance_exception_taxonomy.sql"),
);
cartUpgrade.exec(`
  INSERT INTO customer (id, auth_user_id, status, created_at, updated_at)
    VALUES ('cart-upgrade-customer', 'cart-upgrade-auth', 'active', 1, 1);
  INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES
    ('cart-upgrade-old', 'cart-upgrade-customer', 'location-cebu-central', 'ACTIVE', 1, 1, 1),
    ('cart-upgrade-middle', 'cart-upgrade-customer', 'location-cebu-central', 'ACTIVE', 1, 2, 2),
    ('cart-upgrade-winner', 'cart-upgrade-customer', 'location-cebu-central', 'ACTIVE', 4, 3, 3);
  INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES
    ('cart-upgrade-old', 'sku-red-onion-500g', 2),
    ('cart-upgrade-old', 'sku-eggs-6', 3),
    ('cart-upgrade-middle', 'sku-red-onion-500g', 4),
    ('cart-upgrade-winner', 'sku-red-onion-500g', 7);
`);
apply(
  cartUpgrade,
  migrations.filter((migration) => migration.name === "0046_cart_and_inbox_reliability.sql"),
);
assert.deepEqual(
  cartUpgrade
    .prepare(
      `SELECT id, status, version FROM cart
       WHERE customer_id='cart-upgrade-customer'
       ORDER BY id`,
    )
    .all()
    .map((row) => ({ ...row })),
  [
    { id: "cart-upgrade-middle", status: "SUPERSEDED", version: 2 },
    { id: "cart-upgrade-old", status: "SUPERSEDED", version: 2 },
    { id: "cart-upgrade-winner", status: "ACTIVE", version: 4 },
  ],
);
assert.deepEqual(
  cartUpgrade
    .prepare(
      `SELECT sku_id, quantity FROM cart_item
       WHERE cart_id='cart-upgrade-winner' ORDER BY sku_id`,
    )
    .all()
    .map((row) => ({ ...row })),
  [
    { sku_id: "sku-eggs-6", quantity: 3 },
    { sku_id: "sku-red-onion-500g", quantity: 7 },
  ],
  "0045 must retain the winning cart value and merge SKUs absent from it",
);
assert.equal(
  cartUpgrade
    .prepare(
      "SELECT COUNT(*) AS count FROM domain_event WHERE aggregate_id='cart-upgrade-winner' AND event_type='DUPLICATE_ACTIVE_CARTS_RECONCILED'",
    )
    .get().count,
  1,
);
assert.throws(() =>
  cartUpgrade.exec(
    "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES ('cart-upgrade-duplicate', 'cart-upgrade-customer', 'location-cebu-central', 'ACTIVE', 1, 4, 4)",
  ),
);
assert.deepEqual(cartUpgrade.prepare("PRAGMA foreign_key_check").all(), []);
cartUpgrade.close();

// Customer launch migration is additive over live Membership/Promotions data and
// establishes the quote-claim, follow-up, notification, and invoice seams in
// one reserved migration.
const customerMvpUpgrade = database();
apply(
  customerMvpUpgrade,
  migrations.filter((migration) => migration.name <= "0046_cart_and_inbox_reliability.sql"),
);
customerMvpUpgrade.exec(`
  INSERT INTO customer (id, auth_user_id, status, created_at, updated_at)
    VALUES ('customer-launch-upgrade', 'auth-customer-launch-upgrade', 'active', 1, 1);
  INSERT INTO promotion_redemption
    (id, grant_id, benefit_code, benefit_type, customer_id, subject_type, subject_id, redeemed_at)
    VALUES ('customer-launch-intro-redemption', 'grant-introductory-trial', 'INTRO_TRIAL',
            'MEMBERSHIP_FEE_WAIVER', 'customer-launch-upgrade', 'subscription', 'historical-sub', 1);
`);
apply(
  customerMvpUpgrade,
  migrations.filter((migration) => migration.name === "0047_customer_mvp_completion.sql"),
);
assert.equal(
  customerMvpUpgrade
    .prepare(
      "SELECT COUNT(*) AS count FROM promotion_redemption WHERE id='customer-launch-intro-redemption'",
    )
    .get().count,
  1,
  "0047 must preserve introductory-trial redemption history",
);
for (const table of [
  "promotion_rule",
  "checkout_promotion_claim",
  "order_promotion_application",
  "notification_outbox",
  "notification_attempt",
  "order_invoice_readiness",
]) {
  assert.equal(
    customerMvpUpgrade
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?")
      .get(table).count,
    1,
    `0047 must create ${table}`,
  );
}
assert.deepEqual(customerMvpUpgrade.prepare("PRAGMA foreign_key_check").all(), []);
customerMvpUpgrade.close();

console.log(
  "Migrations verified: fresh apply plus populated 0020 -> current commerce, 0032 -> 0033 analytics, 0045 -> 0046 cart reliability, and 0046 -> 0047 customer launch upgrades are valid.",
);
