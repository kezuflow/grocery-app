import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { z } from "@freshmarkets/validation";
import seedSql from "../seeds/development.sql?raw";

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
}, 30_000);
