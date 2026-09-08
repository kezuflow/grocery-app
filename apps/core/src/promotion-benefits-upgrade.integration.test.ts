import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { z } from "@freshmarkets/validation";
import seedSql from "../seeds/fixtures/retained-0068.sql?raw";

it("upgrades the retained promotion graph without changing committed financial evidence", async () => {
  if (!("TEST_MIGRATIONS" in env) || typeof env.TEST_MIGRATIONS !== "string")
    throw new Error("Missing migrations");
  const migrations = z
    .array(z.object({ name: z.string(), queries: z.array(z.string()) }))
    .parse(JSON.parse(env.TEST_MIGRATIONS));
  await env.DB.batch(
    seedSql
      .split(/;\s*(?:\r?\n|$)/)
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => env.DB.prepare(sql)),
  );
  await applyD1Migrations(
    env.DB,
    migrations.filter((item) => item.name >= "0069" && item.name < "0085"),
  );
  const order = await env.DB.prepare(
    "SELECT id,customer_id FROM grocery_order ORDER BY id LIMIT 1",
  ).first<{ id: string; customer_id: string }>();
  const quote = await env.DB.prepare("SELECT id FROM checkout_quote WHERE customer_id=? LIMIT 1")
    .bind(order?.customer_id ?? "")
    .first<{ id: string }>();
  if (!order || !quote) throw new Error("Missing retained commerce graph");
  const snapshot = JSON.stringify({ type: "DELIVERY_FEE_DISCOUNT", percent: 25, amountMinor: 100 });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO promotion(id,code,name,status,benefit_type,percent,minimum_minor,starts_at,version,created_at,updated_at) VALUES ('upgrade-p','UPGRADE_PERCENT','Retained delivery','ACTIVE','DELIVERY_FEE_DISCOUNT',25,0,1,7,1,1)",
    ),
    env.DB.prepare(
      "INSERT INTO promotion_rule(id,promotion_id,rule_type,parameters_json) VALUES ('upgrade-rule','upgrade-p','FIRST_ORDER','{}')",
    ),
    env.DB.prepare(
      "INSERT INTO promotion_grant(id,benefit_code,benefit_type,max_redemptions,customer_id,created_at,updated_at) VALUES ('upgrade-grant','UPGRADE_PERCENT','DELIVERY_FEE_DISCOUNT',2,?,1,1)",
    ).bind(order.customer_id),
    env.DB.prepare(
      "INSERT INTO promotion_redemption(id,grant_id,benefit_code,benefit_type,customer_id,promotion_id,order_id,price_component,amount_minor,benefit_snapshot_json,redeemed_at) VALUES ('upgrade-redemption','upgrade-grant','UPGRADE_PERCENT','DELIVERY_FEE_DISCOUNT',?,'upgrade-p',?,'DELIVERY',100,?,1)",
    ).bind(order.customer_id, order.id, snapshot),
    env.DB.prepare(
      "INSERT INTO order_promotion_application(id,order_id,promotion_id,redemption_id,price_component,benefit_type,amount_minor,benefit_snapshot_json,created_at) VALUES ('upgrade-application',?,'upgrade-p','upgrade-redemption','DELIVERY','DELIVERY_FEE_DISCOUNT',100,?,1)",
    ).bind(order.id, snapshot),
    env.DB.prepare(
      "INSERT INTO checkout_promotion_claim(id,checkout_quote_id,promotion_id,customer_id,price_component,benefit_type,amount_minor,definition_version,grant_id,snapshot_json,status,created_at,committed_at) VALUES ('upgrade-claim',?,'upgrade-p',?,'DELIVERY','DELIVERY_FEE_DISCOUNT',100,7,'upgrade-grant',?,'COMMITTED',1,1)",
    ).bind(quote.id, order.customer_id, snapshot),
  ]);
  const quoteName = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name!='d1_migrations'",
  ).all<{ name: string }>();
  const before = [];
  for (const { name } of tables.results) {
    const sql = `SELECT rowid,* FROM ${quoteName(name)} ORDER BY rowid`;
    const rows = (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
    if (name === "promotion")
      for (const row of rows)
        if (row.benefit_type === "DELIVERY_FEE_DISCOUNT") {
          row.benefit_type = "DELIVERY_PERCENT_DISCOUNT";
          if (typeof row.version !== "number") throw new Error("Invalid version");
          row.version += 1;
        }
    before.push({ name, sql, rows });
  }
  const migration = migrations.find((item) => item.name === "0085_promotion_benefits.sql");
  if (!migration) throw new Error("Missing benefit migration");
  await applyD1Migrations(env.DB, [migration]);
  for (const table of before)
    expect((await env.DB.prepare(table.sql).all()).results, table.name).toEqual(table.rows);
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  for (const name of [
    "promotion",
    "promotion_rule",
    "promotion_grant",
    "promotion_redemption",
    "order_promotion_application",
    "checkout_promotion_claim",
  ])
    expect(await env.DB.prepare(`PRAGMA quick_check(${quoteName(name)})`).first()).toEqual({
      quick_check: "ok",
    });
  await env.DB.prepare(
    "INSERT INTO promotion(id,code,name,status,benefit_type,discount_minor,minimum_minor,starts_at,version,created_at,updated_at) VALUES ('new-delivery-fixed','NEW_DELIVERY_FIXED','New fixed delivery','DRAFT','DELIVERY_FIXED_DISCOUNT',100,0,1,1,1,1)",
  ).run();
  expect(
    await env.DB.prepare("SELECT benefit_type,version FROM promotion WHERE id='upgrade-p'").first(),
  ).toEqual({ benefit_type: "DELIVERY_PERCENT_DISCOUNT", version: 8 });
}, 30000);
