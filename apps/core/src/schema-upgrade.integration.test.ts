import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { z } from "@freshmarkets/validation";
import seedSql from "../seeds/fixtures/retained-0068.sql?raw";

it("rolls back an invalid retained D1 upgrade and then preserves the full valid commerce graph", async () => {
  if (!("TEST_MIGRATIONS" in env) || typeof env.TEST_MIGRATIONS !== "string")
    throw new Error("Missing test migrations");
  const migrations = z
    .array(z.object({ name: z.string(), queries: z.array(z.string()) }))
    .parse(JSON.parse(env.TEST_MIGRATIONS));
  const migration = migrations.find((candidate) => candidate.name === "0069_schema_integrity.sql");
  if (!migration) throw new Error("Missing hardening migration");
  await env.DB.batch(
    seedSql
      .split(/;\s*(?:\r?\n|$)/)
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => env.DB.prepare(sql)),
  );
  const balance = await env.DB.prepare(
    "SELECT location_id,inventory_pool_id,on_hand FROM inventory_balance LIMIT 1",
  ).first<{ location_id: string; inventory_pool_id: string; on_hand: number }>();
  if (!balance) throw new Error("Missing stock fixture");
  await env.DB.prepare(
    "UPDATE inventory_balance SET on_hand=-1 WHERE location_id=? AND inventory_pool_id=?",
  )
    .bind(balance.location_id, balance.inventory_pool_id)
    .run();
  const beforeSchema = await env.DB.prepare(
    "SELECT name,sql FROM sqlite_schema ORDER BY name",
  ).all();
  const beforeOrders = await env.DB.prepare("SELECT * FROM grocery_order ORDER BY id").all();
  await expect(applyD1Migrations(env.DB, [migration])).rejects.toThrow(/on_hand >= 0/);
  expect(
    (await env.DB.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all()).results,
  ).toEqual(beforeSchema.results);
  expect((await env.DB.prepare("SELECT * FROM grocery_order ORDER BY id").all()).results).toEqual(
    beforeOrders.results,
  );
  await env.DB.prepare(
    "UPDATE inventory_balance SET on_hand=? WHERE location_id=? AND inventory_pool_id=?",
  )
    .bind(balance.on_hand, balance.location_id, balance.inventory_pool_id)
    .run();
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name!='d1_migrations'",
  ).all<{ name: string }>();
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const snapshots: { sql: string; rows: Record<string, unknown>[] }[] = [];
  for (const { name } of tables.results) {
    const columns = await env.DB.prepare(`PRAGMA table_info(${quote(name)})`).all<{
      name: string;
    }>();
    const selected = columns.results
      .map((column) => column.name)
      .filter(
        (column) =>
          !(name === "inventory_pool" && column === "product_id") &&
          !(name === "payment_refund" && column === "canonical_status") &&
          !(name === "service_fee_configuration" && column === "active_for_new_commerce"),
      );
    const sql = `SELECT rowid,${selected.map(quote).join(",")} FROM ${quote(name)} ORDER BY rowid`;
    snapshots.push({
      sql,
      rows: (await env.DB.prepare(sql).all<Record<string, unknown>>()).results,
    });
  }
  await applyD1Migrations(env.DB, [migration]);
  for (const snapshot of snapshots)
    expect((await env.DB.prepare(snapshot.sql).all()).results).toEqual(snapshot.rows);
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  // Bound SQLite's integrity-check working set; a whole-database quick_check
  // exceeds the local D1 runtime's allocation limit for this schema.
  for (const { name } of tables.results)
    expect(await env.DB.prepare(`PRAGMA quick_check(${quote(name)})`).first()).toEqual({
      quick_check: "ok",
    });
  const retainedReceipts = (
    await env.DB.prepare("SELECT id,accepted_quantity FROM receiving_record ORDER BY id").all<{
      id: string;
      accepted_quantity: number;
    }>()
  ).results;
  const retainedStock = (
    await env.DB.prepare(
      "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
    ).all()
  ).results;
  const retainedLedger = (
    await env.DB.prepare("SELECT * FROM inventory_ledger_entries ORDER BY id").all()
  ).results;
  const retainedCustomers = (
    await env.DB.prepare(
      "SELECT id,auth_user_id,principal_id,status,version,created_at,updated_at FROM customer ORDER BY id",
    ).all()
  ).results;
  await applyD1Migrations(
    env.DB,
    migrations.filter((candidate) => candidate.name > migration.name && candidate.name < "0081_"),
  );
  await env.DB.prepare(
    "INSERT INTO notification_attempt(id,notification_id,status,attempted_at,completed_at) SELECT 'retained-email-attempt',id,'SENT',created_at,created_at FROM notification_outbox LIMIT 1",
  ).run();
  const emailSnapshots: { sql: string; rows: Record<string, unknown>[] }[] = [];
  for (const name of ["notification_outbox", "notification_attempt"]) {
    const columns = await env.DB.prepare(`PRAGMA table_info(${quote(name)})`).all<{
      name: string;
    }>();
    const sql = `SELECT rowid,${columns.results.map((column) => quote(column.name)).join(",")} FROM ${quote(name)} ORDER BY rowid`;
    emailSnapshots.push({
      sql,
      rows: (await env.DB.prepare(sql).all<Record<string, unknown>>()).results,
    });
  }
  expect(emailSnapshots[1]?.rows.length).toBeGreaterThan(0);
  const retainedCycles = (
    await env.DB.prepare("SELECT rowid,* FROM delivery_cycle ORDER BY id").all()
  ).results;
  const retainedFulfillment = (
    await env.DB.prepare("SELECT rowid,* FROM order_fulfillment_snapshot ORDER BY order_id").all()
  ).results;
  await applyD1Migrations(
    env.DB,
    migrations.filter((candidate) => candidate.name >= "0081_"),
  );
  for (const snapshot of emailSnapshots)
    expect((await env.DB.prepare(snapshot.sql).all()).results).toEqual(snapshot.rows);
  expect(
    (await env.DB.prepare("SELECT rowid,* FROM delivery_cycle ORDER BY id").all()).results,
  ).toEqual(retainedCycles);
  expect(
    (await env.DB.prepare("SELECT rowid,* FROM order_fulfillment_snapshot ORDER BY order_id").all())
      .results,
  ).toEqual(retainedFulfillment);
  expect(
    await env.DB.prepare("SELECT count(*) count FROM delivery_cycle_schedule").first(),
  ).toEqual({ count: 0 });
  expect(await env.DB.prepare("SELECT count(*) count FROM delivery_cycle_window").first()).toEqual({
    count: 0,
  });
  expect(
    await env.DB.prepare("SELECT count(*) count FROM order_delivery_window_snapshot").first(),
  ).toEqual({ count: 0 });
  const retainedScheduledOrder = await env.DB.prepare(
    "SELECT order_id,cycle_id FROM order_fulfillment_snapshot WHERE cycle_id IS NOT NULL ORDER BY order_id LIMIT 1",
  ).first<{ order_id: string; cycle_id: string }>();
  if (!retainedScheduledOrder) throw new Error("Retained Scheduled Order fixture is required");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,cutoff_at,delivery_date,status,capacity,allocated,version) VALUES ('upgrade-other-cycle','market-metro-cebu','Other cycle',0,1,2,'DRAFT',0,0,1)",
    ),
    env.DB.prepare(
      "INSERT INTO delivery_cycle_window(id,cycle_id,name,starts_at,ends_at,created_at) VALUES ('upgrade-other-window','upgrade-other-cycle','Other window',2,3,0)",
    ),
  ]);
  await expect(
    env.DB.prepare(
      "INSERT INTO order_delivery_window_snapshot(order_id,cycle_id,window_id,name,timezone,starts_at,ends_at,pickup_at,created_at) VALUES (?,?,'upgrade-other-window','Other window','Asia/Manila',2,3,1,0)",
    )
      .bind(retainedScheduledOrder.order_id, retainedScheduledOrder.cycle_id)
      .run(),
  ).rejects.toThrow(/FOREIGN KEY/i);
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect(
    (
      await env.DB.prepare(
        "SELECT id,legacy_accepted_base accepted_quantity FROM receiving_record ORDER BY id",
      ).all()
    ).results,
  ).toEqual(retainedReceipts);
  expect(retainedReceipts.some((receipt) => receipt.accepted_quantity > 0)).toBe(true);
  expect(
    (
      await env.DB.prepare(
        "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
      ).all()
    ).results,
  ).toEqual(retainedStock);
  expect(
    (await env.DB.prepare("SELECT * FROM inventory_ledger_entries ORDER BY id").all()).results,
  ).toEqual(retainedLedger);
  expect(await env.DB.prepare("SELECT COUNT(*) count FROM cycle_goods_balance").first()).toEqual({
    count: 0,
  });
  expect(await env.DB.prepare("SELECT COUNT(*) count FROM cycle_goods_movement").first()).toEqual({
    count: 0,
  });
  expect(
    await env.DB.prepare("SELECT COUNT(*) count FROM initial_administrator_setup").first(),
  ).toEqual({ count: 0 });
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect(
    (
      await env.DB.prepare(
        "SELECT id,auth_user_id,principal_id,status,version,created_at,updated_at FROM customer ORDER BY id",
      ).all()
    ).results,
  ).toEqual(retainedCustomers);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM customer WHERE preferred_language IS NOT NULL OR promotional_emails!=0",
    ).first(),
  ).toEqual({ count: 0 });
}, 30_000);
