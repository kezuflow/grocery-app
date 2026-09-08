import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../apps/core/migrations/", import.meta.url);
const migrations = readdirSync(directory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
function apply(database, names) {
  for (const name of names) {
    database.exec("BEGIN; PRAGMA defer_foreign_keys=ON;");
    try {
      database.exec(readFileSync(new URL(name, directory), "utf8"));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
function baseline() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  apply(
    database,
    migrations.filter((name) => name < "0069"),
  );
  database.exec("BEGIN; PRAGMA defer_foreign_keys=ON;");
  database.exec(
    readFileSync(new URL("../apps/core/seeds/fixtures/retained-0068.sql", import.meta.url), "utf8"),
  );
  database.exec("COMMIT");
  return database;
}
const database = baseline();
const removed = {
  inventory_pool: ["product_id"],
  payment_refund: ["canonical_status"],
  service_fee_configuration: ["active_for_new_commerce"],
};
const before = database
  .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map(({ name }) => {
    const columns = database
      .prepare(`PRAGMA table_info(${quote(name)})`)
      .all()
      .map((column) => column.name)
      .filter((column) => !(removed[name] ?? []).includes(column));
    const query = `SELECT rowid,${columns.map(quote).join(",")} FROM ${quote(name)} ORDER BY rowid`;
    return { name, query, rows: database.prepare(query).all() };
  });
apply(
  database,
  migrations.filter((name) => name.startsWith("0069_")),
);
for (const snapshot of before)
  assert.deepEqual(
    database.prepare(snapshot.query).all(),
    snapshot.rows,
    `${snapshot.name}: preserve retained values and row identities`,
  );
// Prove the hardening rebuild separately from later additive migrations.
// 0070 adds explicit capabilities; it must preserve existing grants and prices.
const permissionsBeforePricing = database
  .prepare("SELECT rowid,* FROM permission ORDER BY rowid")
  .all();
const grantsBeforePricing = database
  .prepare("SELECT rowid,* FROM role_permission ORDER BY rowid")
  .all();
const pricesBeforePricing = database
  .prepare("SELECT rowid,* FROM price_version ORDER BY rowid")
  .all();
const locationsBeforeSetup = database
  .prepare("SELECT rowid,* FROM fulfillment_location ORDER BY rowid")
  .all();
const receiptsBeforeCycleGoods = database
  .prepare("SELECT rowid,* FROM receiving_record ORDER BY rowid")
  .all();
const receiptEventsBeforeCycleGoods = database
  .prepare("SELECT rowid,* FROM receiving_event ORDER BY rowid")
  .all();
const balancesBeforeCycleGoods = database
  .prepare("SELECT rowid,* FROM inventory_balance ORDER BY rowid")
  .all();
const ledgerBeforeCycleGoods = database
  .prepare("SELECT rowid,* FROM inventory_ledger_entries ORDER BY rowid")
  .all();
database
  .prepare(
    "INSERT INTO payment_reconciliation_case(id,category,status,details_json,created_at,resolved_at) VALUES (?,?,?,?,?,?)",
  )
  .run(
    "retained-review-evidence",
    "AMBIGUOUS_OUTCOME",
    "RESOLVED",
    JSON.stringify({ retained: true }),
    1700000000000,
    1700000001000,
  );
const paymentsBeforeLookupRecovery = database
  .prepare("SELECT rowid,* FROM payment_intent ORDER BY rowid")
  .all();
const casesBeforeVersion = database
  .prepare("SELECT rowid,* FROM payment_reconciliation_case ORDER BY rowid")
  .all();
apply(
  database,
  migrations.filter((name) => name > "0069_schema_integrity.sql"),
);
assert.deepEqual(
  database.prepare("SELECT rowid,* FROM payment_intent ORDER BY rowid").all(),
  paymentsBeforeLookupRecovery,
);
assert.equal(database.prepare("SELECT COUNT(*) count FROM payment_lookup_recovery").get().count, 0);
assert.throws(
  () =>
    database.exec(
      "INSERT INTO payment_lookup_recovery(payment_intent_id,status,available_at,created_at,updated_at) VALUES ('missing-payment','PENDING',1,1,1)",
    ),
  /FOREIGN KEY constraint failed/,
);
assert.deepEqual(
  database
    .prepare(
      "SELECT rowid,id,payment_intent_id,category,status,details_json,created_at,resolved_at FROM payment_reconciliation_case ORDER BY rowid",
    )
    .all(),
  casesBeforeVersion,
);
assert.equal(
  database
    .prepare("SELECT version FROM payment_reconciliation_case WHERE id='retained-review-evidence'")
    .get().version,
  1,
);
assert.throws(
  () =>
    database.exec(
      "UPDATE payment_reconciliation_case SET version=0 WHERE id='retained-review-evidence'",
    ),
  /CHECK constraint failed/,
);

assert.deepEqual(
  database
    .prepare(
      "SELECT rowid,* FROM permission WHERE code NOT IN ('prices.read','prices.manage','locations.read','locations.manage') ORDER BY rowid",
    )
    .all(),
  permissionsBeforePricing,
);
assert.deepEqual(
  database
    .prepare(
      "SELECT code FROM permission WHERE code IN ('prices.read','prices.manage','locations.read','locations.manage') ORDER BY code",
    )
    .all()
    .map((row) => row.code),
  ["locations.manage", "locations.read", "prices.manage", "prices.read"],
);
assert.deepEqual(
  database.prepare("SELECT rowid,* FROM role_permission ORDER BY rowid").all(),
  grantsBeforePricing,
);
assert.deepEqual(
  database.prepare("SELECT rowid,* FROM price_version ORDER BY rowid").all(),
  pricesBeforePricing,
);
assert.deepEqual(
  database
    .prepare("SELECT rowid,* FROM fulfillment_location ORDER BY rowid")
    .all()
    .map(({ purpose, ...row }) => {
      assert.equal(purpose, "CUSTOMER_FULFILLMENT");
      return row;
    }),
  locationsBeforeSetup.map((row) => ({ ...row })),
);
assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
assert.ok(
  receiptsBeforeCycleGoods.some((row) => row.accepted_quantity > 0),
  "Upgrade exercises accepted retained receipts",
);
assert.deepEqual(
  database
    .prepare("SELECT rowid,* FROM receiving_record ORDER BY rowid")
    .all()
    .map(({ legacy_accepted_base, ...row }) => {
      assert.equal(legacy_accepted_base, row.accepted_quantity);
      return row;
    }),
  receiptsBeforeCycleGoods.map((row) => ({ ...row })),
);
assert.deepEqual(
  database.prepare("SELECT rowid,* FROM receiving_event ORDER BY rowid").all(),
  receiptEventsBeforeCycleGoods,
);
assert.deepEqual(
  database.prepare("SELECT rowid,* FROM inventory_balance ORDER BY rowid").all(),
  balancesBeforeCycleGoods,
);
assert.deepEqual(
  database.prepare("SELECT rowid,* FROM inventory_ledger_entries ORDER BY rowid").all(),
  ledgerBeforeCycleGoods,
);
assert.equal(database.prepare("SELECT COUNT(*) count FROM cycle_goods_balance").get().count, 0);
assert.equal(database.prepare("SELECT COUNT(*) count FROM cycle_goods_movement").get().count, 0);
const retainedReceipt = receiptsBeforeCycleGoods.find((row) => row.accepted_quantity > 0);
assert.throws(
  () =>
    database
      .prepare("UPDATE receiving_record SET legacy_accepted_base=0 WHERE id=?")
      .run(retainedReceipt.id),
  /IMMUTABLE_LEGACY_RECEIPT_EVIDENCE/,
);
assert.deepEqual(
  database
    .prepare("SELECT market_id,version,updated_at FROM geography_configuration ORDER BY market_id")
    .all()
    .map((row) => ({ ...row })),
  database
    .prepare("SELECT id market_id,1 version,0 updated_at FROM market ORDER BY id")
    .all()
    .map((row) => ({ ...row })),
);
assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
for (const { name } of before) {
  for (const column of database
    .prepare(`PRAGMA table_info(${quote(name)})`)
    .all()
    .filter((column) => column.pk))
    assert.equal(column.notnull, 1, `${name}.${column.name}: non-null PK`);
}
for (const [sql, expected] of [
  [
    "SELECT SUM(quantity) FROM checkout_inventory_holds WHERE location_id=? AND inventory_pool_id=? AND status='HELD'",
    "inventory_hold_location_pool_held_idx",
  ],
  ["SELECT id FROM order_item WHERE order_id=?", "order_item_order_idx"],
  [
    "SELECT id FROM paid_order_amendment_line WHERE amendment_id=? ORDER BY created_at,id",
    "paid_order_amendment_line_amendment_idx",
  ],
  [
    "SELECT id FROM payment_attempt WHERE payment_intent_id=? ORDER BY created_at DESC LIMIT 1",
    "payment_attempt_intent_created_idx",
  ],
  [
    "SELECT id FROM payment_attempt WHERE provider=? AND provider_reference=?",
    "payment_attempt_provider_reference_unique",
  ],
  [
    "SELECT id FROM receiving_record WHERE procurement_requirement_id=?",
    "receiving_record_requirement_idx",
  ],
  [
    "SELECT id FROM grocery_order WHERE customer_id=? ORDER BY COALESCE(committed_at,created_at) DESC,id DESC LIMIT 26",
    "grocery_order_customer_history_idx",
  ],
]) {
  const plan = database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array.from(sql.matchAll(/\?/g), () => "fixture"))
    .map((row) => row.detail)
    .join("\n");
  assert.ok(plan.includes(expected), plan);
  assert.ok(!plan.includes("USE TEMP B-TREE"), plan);
}
database.close();
// An invalid retained row must abort the entire rebuild and preserve its original database.
const invalid = baseline();
invalid.exec(
  "UPDATE inventory_balance SET on_hand=-1 WHERE rowid=(SELECT rowid FROM inventory_balance LIMIT 1)",
);
const inventoryBefore = invalid.prepare("SELECT * FROM inventory_balance ORDER BY rowid").all();
assert.throws(
  () =>
    apply(
      invalid,
      migrations.filter((name) => name >= "0069"),
    ),
  /on_hand >= 0/,
);
assert.deepEqual(
  invalid.prepare("SELECT * FROM inventory_balance ORDER BY rowid").all(),
  inventoryBefore,
);
assert.equal(
  invalid.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE name LIKE 'schema_0069_%'").get()
    .count,
  0,
);
assert.ok(
  invalid
    .prepare("PRAGMA table_info(inventory_pool)")
    .all()
    .some((column) => column.name === "product_id"),
);
invalid.close();
console.info(
  "Schema integrity verified: populated 0068 upgrade preserves all retained rows; invalid stock rolls back; primary keys and seven query plans verified.",
);
