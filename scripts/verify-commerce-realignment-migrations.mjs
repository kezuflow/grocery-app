import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const migrationDirectory = join(process.cwd(), "apps", "core", "migrations");
const migrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationDirectory, name), "utf8") }));

const phaseTwoEnd = "0059_refund_outbox_and_order_number_reliability.sql";

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

function through(name) {
  return migrations.filter((migration) => migration.name <= name);
}

function after(start, end) {
  return migrations.filter((migration) => migration.name > start && migration.name <= end);
}

function columns(database, table) {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);
}

function assertPhaseTwoSchema(database) {
  assert.deepEqual(
    { ...database.prepare("SELECT * FROM global_commerce_configuration").get() },
    {
      id: "global",
      selling_state: "OPEN",
      fulfillment_mode: "SCHEDULED",
      cadence: "WEEKLY",
      version: 1,
      created_at: 0,
      updated_at: 0,
    },
  );

  assert.ok(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_cycle_zone'")
      .get(),
  );
  assert.equal(columns(database, "delivery_cycle_zone").includes("capacity"), false);

  for (const column of [
    "provider_quotation_snapshot_json",
    "delivery_execution_snapshot_json",
    "checkout_delivery_charge_minor",
  ]) {
    assert.ok(columns(database, "order_fulfillment_snapshot").includes(column), column);
  }

  for (const column of [
    "checkout_quotation_id",
    "final_quotation_id",
    "final_payable_minor",
    "customer_delivery_charge_minor",
    "courier_variance_minor",
    "delivery_currency",
  ]) {
    assert.ok(columns(database, "delivery_provider_dispatch").includes(column), column);
  }

  for (const column of [
    "demand_basis",
    "order_item_id",
    "sku_id",
    "quantity_sellable",
    "quantity_base_total",
    "base_unit_code",
    "shipping_weight_grams",
  ]) {
    assert.ok(columns(database, "committed_demand").includes(column), column);
  }

  for (const column of [
    "publication_status",
    "queue_message_id",
    "publication_attempts",
    "lease_owner",
    "lease_expires_at",
    "dead_lettered_at",
  ]) {
    assert.ok(columns(database, "notification_outbox").includes(column), column);
  }

  const priceColumns = database.prepare("PRAGMA table_info(price_version)").all();
  assert.equal(priceColumns.find((column) => column.name === "location_id")?.notnull, 1);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
}

const fresh = database();
apply(fresh, through(phaseTwoEnd));
assertPhaseTwoSchema(fresh);
fresh.close();

const recovery = database();
apply(recovery, through("0065_promotion_usage_guards.sql"));
recovery.exec(`INSERT INTO delivery_provider_event_inbox
  (id,provider,provider_event_id,provider_delivery_id,merchant_order_id,observed_at,
   provider_status,payload_hash,raw_payload,processing_status,received_at)
  VALUES ('retained-delivery-event','lalamove','retained-event','provider-id','merchant-id',1,
    'IN_DELIVERY','fixture-hash','{}','RECEIVED',1)`);
apply(
  recovery,
  migrations.filter((migration) => migration.name > "0065_promotion_usage_guards.sql"),
);
assert.deepEqual(
  {
    ...recovery
      .prepare(`SELECT processing_status,recovery_attempts,next_recovery_at
  FROM delivery_provider_event_inbox WHERE id='retained-delivery-event'`)
      .get(),
  },
  { processing_status: "RECEIVED", recovery_attempts: 0, next_recovery_at: 0 },
);
assert.throws(() => recovery.exec("UPDATE delivery_provider_event_inbox SET recovery_attempts=-1"));
assert.deepEqual(recovery.prepare("PRAGMA foreign_key_check").all(), []);
recovery.close();

const populated = database();
apply(populated, through("0055_delivery_provider_dispatch.sql"));
populated.exec(`
  INSERT INTO customer (id, auth_user_id, status, created_at, updated_at)
  VALUES ('realignment-customer', 'realignment-auth', 'active', 1, 1);

  INSERT INTO customer_address
    (id, customer_id, label, recipient, phone, address_json, latitude, longitude,
     status, version, created_at, updated_at)
  VALUES
    ('realignment-address', 'realignment-customer', 'Home', 'Customer', '09170000000',
     '{}', 10.32, 123.9, 'active', 1, 1, 1);

  INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at)
  VALUES ('realignment-cart', 'realignment-customer', 'location-cebu-central',
          'ACTIVE', 1, 1, 1);
  INSERT INTO cart_item (cart_id, sku_id, quantity)
  VALUES ('realignment-cart', 'sku-red-onion-500g', 1);

  INSERT INTO checkout_attempts
    (id, customer_id, cart_id, address_id, cycle_id, fulfillment_mode, zone_id,
     location_id, quote_version, status, idempotency_key, expires_at, version,
     created_at, updated_at)
  VALUES
    ('realignment-attempt', 'realignment-customer', 'realignment-cart',
     'realignment-address', 'cycle-next-cebu', 'SCHEDULED', 'zone-cebu-city-core',
     'location-cebu-central', 1, 'PROCESSING', 'realignment-attempt-key',
     9999999999999, 1, 1, 1);

  INSERT INTO checkout_quote_snapshots
    (id, checkout_attempt_id, merchandise_minor, delivery_fee_minor, discount_minor,
     total_minor, currency, item_snapshot_json, eligibility_snapshot_json, created_at)
  VALUES
    ('realignment-quote-snapshot', 'realignment-attempt', 10000, 1500, 500,
     11000, 'PHP', '[]', '{}', 1);

  INSERT INTO payment_intent
    (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency,
     status, idempotency_key, version, created_at, updated_at)
  VALUES
    ('realignment-intent', 'GROCERY_CHECKOUT', 'CHECKOUT_QUOTE', 'realignment-attempt',
     'realignment-customer', 11000, 'PHP', 'SUCCEEDED', 'realignment-intent-key', 1, 1, 1);

  INSERT INTO payment_attempt
    (id, customer_id, amount_minor, currency, status, provider, provider_reference,
     idempotency_key, created_at, updated_at, version, checkout_attempt_id,
     payment_intent_id)
  VALUES
    ('realignment-mock-payment', 'realignment-customer', 11000, 'PHP', 'SUCCEEDED',
     'mock', 'mock-reference', 'realignment-payment-key', 1, 1, 1,
     'realignment-attempt', 'realignment-intent');

  INSERT INTO grocery_order
    (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status,
     total_minor, currency, payment_id, version, created_at,
     merchandise_subtotal_minor, delivery_subtotal_minor, service_fee_minor,
     pre_service_fee_total_minor, service_fee_snapshot_json)
  VALUES
    ('realignment-order', 'realignment-customer', 'cycle-next-cebu', 'SCHEDULED',
     '{}', 'COMMITTED', 11000, 'PHP', 'realignment-mock-payment', 1, 1,
     10000, 1500, 250, 10750, '{"version":1,"feeMinor":250}');

  INSERT INTO order_item
    (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot,
     unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity)
  VALUES
    ('realignment-order-item', 'realignment-order', 'sku-red-onion-500g',
     'Red onion', '500 g', 'GRAM', 1, 10000, 10000, 500);

  INSERT INTO order_fulfillment_snapshot
    (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date,
     fulfillment_mode, sourcing_modes_json, delivery_fee_snapshot_json, created_at)
  VALUES
    ('realignment-order', 'location-cebu-central', 'cycle-next-cebu',
     'zone-cebu-city-core', 2, 3, 'SCHEDULED', '["PLANNED"]',
     '{"version":1,"amountMinor":1500}', 1);

  INSERT INTO committed_demand
    (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity,
     status, version)
  VALUES
    ('realignment-legacy-demand', 'realignment-order', 'cycle-next-cebu',
     'location-cebu-central', 'pool-red-onion', 500, 'OPEN', 1);

  INSERT INTO procurement_requirement
    (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity,
     status, version, created_at, updated_at)
  VALUES
    ('realignment-legacy-requirement', 'cycle-next-cebu', 'location-cebu-central',
     'pool-red-onion', 400, 'CLOSED', 1, 1, 1);

  INSERT INTO service_fee_configuration
    (id, fee_type, flat_minor, percentage_basis_points, currency, effective_from,
     effective_to, version, reason, created_at)
  VALUES
    ('realignment-historical-fee', 'FLAT', 250, 0, 'PHP', 0, NULL, 99,
     'Historical evidence', 1);

  INSERT INTO payment_refund
    (id, payment_intent_id, amount_minor, currency, status, reason,
     idempotency_key, version, created_at, updated_at)
  VALUES
    ('realignment-refund', 'realignment-intent', 500, 'PHP', 'APPROVED',
     'Historical provider-approved state', 'realignment-refund-key', 1, 1, 1);

  INSERT INTO refund
    (id, payment_id, order_id, amount_minor, currency, status, reason,
     created_at, updated_at, version)
  VALUES
    ('realignment-legacy-refund', 'realignment-mock-payment', 'realignment-order',
     100, 'PHP', 'REQUESTED', 'Legacy evidence', 1, 1, 1);

  INSERT INTO notification_outbox
    (id, event_type, aggregate_type, aggregate_id, customer_id, channel,
     recipient_snapshot, template_data_json, status, scheduled_at, available_at,
     attempts, idempotency_key, created_at, updated_at)
  VALUES
    ('realignment-notification', 'ORDER_CONFIRMED', 'ORDER', 'realignment-order',
     'realignment-customer', 'EMAIL', 'customer@example.test', '{}', 'PENDING',
     1, 1, 0, 'realignment-notification-key', 1, 1);

  INSERT INTO rider_identity
    (id, auth_user_id, display_name, preferred_location_id, status, version,
     created_at, updated_at)
  VALUES
    ('realignment-legacy-rider', 'realignment-rider-auth', 'Historical Rider',
     'location-cebu-central', 'ACTIVE', 1, 1, 1);

  INSERT INTO delivery_batch
    (id, fulfillment_mode, cycle_id, location_id, zone_id, rider_id, status,
     context_resolution_status, version, created_at, updated_at)
  VALUES
    ('realignment-legacy-batch', 'SCHEDULED', 'cycle-next-cebu',
     'location-cebu-central', 'zone-cebu-city-core', 'realignment-legacy-rider',
     'DRAFT', 'RESOLVED', 1, 1, 1);
`);

const compatibilityBefore = {
  capacity: {
    ...populated
      .prepare(
        "SELECT capacity, allocated, version FROM cycle_zone_capacity WHERE cycle_id='cycle-next-cebu' AND zone_id='zone-cebu-city-core' AND location_id='location-cebu-central'",
      )
      .get(),
  },
  legacyDemand: {
    ...populated
      .prepare(
        "SELECT order_id, inventory_pool_id, quantity, status, version FROM committed_demand WHERE id='realignment-legacy-demand'",
      )
      .get(),
  },
  serviceFee: {
    ...populated
      .prepare(
        "SELECT id, fee_type, flat_minor, effective_to, version FROM service_fee_configuration WHERE id='realignment-historical-fee'",
      )
      .get(),
  },
};

apply(populated, after("0055_delivery_provider_dispatch.sql", phaseTwoEnd));
assertPhaseTwoSchema(populated);

assert.deepEqual(
  {
    ...populated
      .prepare(
        "SELECT capacity, allocated, version FROM cycle_zone_capacity WHERE cycle_id='cycle-next-cebu' AND zone_id='zone-cebu-city-core' AND location_id='location-cebu-central'",
      )
      .get(),
  },
  compatibilityBefore.capacity,
);
assert.deepEqual(
  {
    ...populated
      .prepare(
        "SELECT order_id, inventory_pool_id, quantity, status, version FROM committed_demand WHERE id='realignment-legacy-demand'",
      )
      .get(),
  },
  compatibilityBefore.legacyDemand,
);
assert.deepEqual(
  {
    ...populated
      .prepare(
        "SELECT id, fee_type, flat_minor, effective_to, version FROM service_fee_configuration WHERE id='realignment-historical-fee'",
      )
      .get(),
  },
  compatibilityBefore.serviceFee,
);
assert.equal(
  populated
    .prepare(
      "SELECT active_for_new_commerce FROM service_fee_configuration WHERE id='realignment-historical-fee'",
    )
    .get().active_for_new_commerce,
  0,
);

assert.deepEqual(
  {
    ...populated
      .prepare(
        `SELECT merchandise_subtotal_minor, item_discount_minor, order_discount_minor,
                delivery_discount_minor, tax_minor, final_total_minor
         FROM checkout_quote_snapshots WHERE id='realignment-quote-snapshot'`,
      )
      .get(),
  },
  {
    merchandise_subtotal_minor: 10000,
    item_discount_minor: 500,
    order_discount_minor: 0,
    delivery_discount_minor: 0,
    tax_minor: 0,
    final_total_minor: 11000,
  },
);
assert.equal(
  populated
    .prepare(
      "SELECT checkout_delivery_charge_minor FROM order_fulfillment_snapshot WHERE order_id='realignment-order'",
    )
    .get().checkout_delivery_charge_minor,
  1500,
);
assert.equal(
  populated.prepare("SELECT order_number FROM grocery_order WHERE id='realignment-order'").get()
    .order_number,
  `FM-HIST-${Buffer.from("realignment-order", "utf8").toString("hex").toUpperCase()}`,
);
assert.deepEqual(
  {
    ...populated
      .prepare(
        "SELECT status, canonical_status, attempt_count, processing_started_at, reconciliation_case_id FROM payment_refund WHERE id='realignment-refund'",
      )
      .get(),
  },
  {
    status: "APPROVED",
    canonical_status: "PROCESSING",
    attempt_count: 0,
    processing_started_at: null,
    reconciliation_case_id: null,
  },
);
assert.deepEqual(
  {
    ...populated
      .prepare(
        "SELECT publication_status, publication_attempts, queue_message_id, lease_owner, dead_lettered_at FROM notification_outbox WHERE id='realignment-notification'",
      )
      .get(),
  },
  {
    publication_status: "PENDING",
    publication_attempts: 0,
    queue_message_id: null,
    lease_owner: null,
    dead_lettered_at: null,
  },
);

for (const [table, id] of [
  ["rider_identity", "realignment-legacy-rider"],
  ["delivery_batch", "realignment-legacy-batch"],
  ["payment_attempt", "realignment-mock-payment"],
  ["refund", "realignment-legacy-refund"],
]) {
  assert.equal(
    populated.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id=?`).get(id).count,
    1,
    `${table} compatibility row was not preserved`,
  );
}

populated.exec(`
  INSERT INTO delivery_job
    (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, status,
     context_resolution_status, address_snapshot_json, version, created_at, updated_at)
  VALUES
    ('realignment-delivery-job', 'realignment-order', 'cycle-next-cebu', 'SCHEDULED',
     'location-cebu-central', 'zone-cebu-city-core', 'UNASSIGNED', 'RESOLVED',
     '{}', 1, 1, 1);

  INSERT INTO delivery_provider_quotation
    (id, checkout_attempt_id, provider, provider_service, provider_quotation_id,
     amount_minor, currency, quoted_at, expires_at, scheduled_pickup_at,
     origin_snapshot_json, destination_snapshot_json, capability_snapshot_json,
     request_hash, status, created_at)
  VALUES
    ('realignment-checkout-quotation', 'realignment-attempt', 'lalamove', 'MOTORCYCLE',
     'checkout-quotation-1', 1500, 'PHP', 10, 20, 15, '{}', '{}', '{}',
     'checkout-request-hash', 'SELECTED', 10);

  INSERT INTO delivery_provider_quotation
    (id, delivery_job_id, provider, provider_service, provider_quotation_id,
     amount_minor, currency, quoted_at, origin_snapshot_json,
     destination_snapshot_json, capability_snapshot_json, request_hash, status,
     created_at)
  VALUES
    ('realignment-final-quotation', 'realignment-delivery-job', 'grab-express',
     'BIKE', 'final-quotation-1', 1200, 'PHP', 30, '{}', '{}', '{}',
     'final-request-hash', 'SELECTED', 30);

  INSERT INTO delivery_provider_dispatch
    (id, delivery_job_id, provider, merchant_order_id, request_hash,
     request_snapshot_json, status, attempt_count, version, created_at, updated_at,
     checkout_quotation_id, final_quotation_id, pickup_timing,
     final_payable_minor, customer_delivery_charge_minor, courier_variance_minor,
     delivery_currency)
  VALUES
    ('realignment-dispatch', 'realignment-delivery-job', 'grab-express',
     'FM-REALIGNMENT', 'dispatch-hash', '{}', 'PENDING', 0, 1, 30, 30,
     'realignment-checkout-quotation', 'realignment-final-quotation', 'IMMEDIATE',
     1200, 1500, -300, 'PHP');

  INSERT INTO committed_demand
    (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity,
     status, version, demand_basis, order_item_id, sku_id, quantity_sellable,
     quantity_base_total, base_unit_code, shipping_weight_grams, committed_at)
  VALUES
    ('realignment-exact-demand', 'realignment-order', 'cycle-next-cebu',
     'location-cebu-central', 'pool-red-onion', 500, 'OPEN', 1,
     'EXACT_PAID_LINE', 'realignment-order-item', 'sku-red-onion-500g', 1,
     500, 'GRAM', 500, 40);

  INSERT INTO procurement_run
    (id, delivery_cycle_id, destination_location_id, status, demand_version,
     version, created_at, updated_at)
  VALUES
    ('realignment-procurement-run', 'cycle-next-cebu', 'location-cebu-central',
     'AGGREGATED', 1, 1, 40, 40);

  INSERT INTO procurement_requirement
    (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity,
     status, version, created_at, updated_at, procurement_run_id, sku_id,
     calculation_basis, committed_quantity_sellable, committed_demand_base,
     shipping_weight_grams, required_base)
  VALUES
    ('realignment-exact-requirement', 'cycle-next-cebu', 'location-cebu-central',
     'pool-red-onion', 500, 'AGGREGATED', 1, 40, 40,
     'realignment-procurement-run', 'sku-red-onion-500g', 'EXACT_PAID_DEMAND',
     1, 500, 500, 500);
`);

assert.deepEqual(
  {
    ...populated
      .prepare(
        "SELECT final_payable_minor, customer_delivery_charge_minor, courier_variance_minor, delivery_currency FROM delivery_provider_dispatch WHERE id='realignment-dispatch'",
      )
      .get(),
  },
  {
    final_payable_minor: 1200,
    customer_delivery_charge_minor: 1500,
    courier_variance_minor: -300,
    delivery_currency: "PHP",
  },
);
assert.throws(() =>
  populated.exec(
    "UPDATE delivery_provider_dispatch SET courier_variance_minor=1 WHERE id='realignment-dispatch'",
  ),
);
assert.equal(
  populated
    .prepare(
      "SELECT required_base=committed_demand_base AS exact FROM procurement_requirement WHERE id='realignment-exact-requirement'",
    )
    .get().exact,
  1,
);
assert.throws(() =>
  populated.exec(
    "UPDATE procurement_requirement SET required_base=499 WHERE id='realignment-exact-requirement'",
  ),
);
assert.throws(() =>
  populated.exec(
    "UPDATE notification_outbox SET publication_status='PUBLISHED' WHERE id='realignment-notification'",
  ),
);
populated.exec(`
  UPDATE notification_outbox
  SET publication_status='PUBLISHED', queue_message_id='queue-message-1',
      published_at=50, updated_at=50
  WHERE id='realignment-notification';
`);

assert.deepEqual(populated.prepare("PRAGMA foreign_key_check").all(), []);
populated.close();

console.log(
  "Commerce realignment migrations verified: fresh apply, populated 0055 upgrade, exact-demand guards, Queue evidence, and compatibility preservation are valid.",
);
