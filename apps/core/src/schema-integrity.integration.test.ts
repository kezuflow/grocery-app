import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import seedSql from "../seeds/development.sql?raw";
import { seedTestInstantOrder } from "./test-commerce-fixtures";

type Row = Record<string, string | number | null>;
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
async function insert(table: string, row: Row) {
  return env.DB.prepare(
    `INSERT INTO ${identifier(table)} (${Object.keys(row).map(identifier).join(",")}) VALUES (${Object.keys(
      row,
    )
      .map(() => "?")
      .join(",")})`,
  )
    .bind(...Object.values(row))
    .run();
}
async function first(table: string): Promise<Row> {
  const row = await env.DB.prepare(`SELECT * FROM ${identifier(table)} LIMIT 1`).first<Row>();
  if (!row) throw new Error(`Missing ${table} fixture`);
  return row;
}
beforeEach(async () => {
  await env.DB.batch(
    seedSql
      .split(/;\s*(?:\r?\n|$)/)
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => env.DB.prepare(sql)),
  );
});

describe("authoritative schema integrity", () => {
  it("stores distinct benefits per component while rejecting duplicate benefit and redemption identities", async () => {
    const order = await first("grocery_order");
    const quote = await first("checkout_quote");
    const grant = await first("promotion_grant");
    for (const index of [1, 2]) {
      const id = `schema-benefit-${index}`;
      await insert("promotion", {
        id,
        code: id,
        name: id,
        description: "",
        status: "ACTIVE",
        benefit_type: "ORDER_FIXED_DISCOUNT",
        discount_minor: 100,
        minimum_minor: 0,
        starts_at: 0,
        created_at: 1,
        updated_at: 1,
      });
      await insert("promotion_redemption", {
        id,
        grant_id: grant.id,
        benefit_code: id,
        benefit_type: "ORDER_FIXED_DISCOUNT",
        customer_id: order.customer_id,
        redeemed_at: 1,
        promotion_id: id,
      });
      const application: Row = {
        id,
        order_id: order.id,
        promotion_id: id,
        redemption_id: id,
        price_component: "MERCHANDISE",
        benefit_type: "ORDER_FIXED_DISCOUNT",
        amount_minor: 100,
        benefit_snapshot_json: "{}",
        created_at: 1,
      };
      await insert("order_promotion_application", application);
      await expect(
        insert("order_promotion_application", { ...application, id: `duplicate-${id}` }),
      ).rejects.toThrow(/UNIQUE/);
      const claim: Row = {
        id,
        checkout_quote_id: quote.id,
        promotion_id: id,
        customer_id: quote.customer_id,
        price_component: "MERCHANDISE",
        benefit_type: "ORDER_FIXED_DISCOUNT",
        amount_minor: 100,
        definition_version: 1,
        snapshot_json: "{}",
        created_at: 1,
      };
      await insert("checkout_promotion_claim", claim);
      await expect(
        insert("checkout_promotion_claim", { ...claim, id: `duplicate-${id}` }),
      ).rejects.toThrow(/UNIQUE/);
    }
    await expect(
      env.DB.prepare(
        "UPDATE order_promotion_application SET redemption_id='schema-benefit-1' WHERE id='schema-benefit-2'",
      ).run(),
    ).rejects.toThrow(/UNIQUE/);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM order_promotion_application WHERE order_id=?",
      )
        .bind(order.id)
        .first(),
    ).toEqual({ count: 2 });
  });
  it.each([false, true])(
    "keeps manual mode and lifecycle eligibility outside storage (Scheduled=%s)",
    async (scheduled) => {
      // Direct persistence probe, not authorization to perform a manual delivery.
      // The future Core commands must enforce mode and handover policy (alignment Phase 6).
      const job = await first("delivery_job");
      const id = crypto.randomUUID();
      await seedTestInstantOrder(env.DB, id);
      if (scheduled)
        await env.DB.prepare(
          "UPDATE grocery_order SET fulfillment_mode='SCHEDULED',cycle_id='cycle-next-cebu' WHERE id=?",
        )
          .bind(id)
          .run();
      await insert("delivery_job", {
        ...job,
        id,
        order_id: id,
        fulfillment_mode: scheduled ? "SCHEDULED" : "INSTANT",
        cycle_id: scheduled ? "cycle-next-cebu" : null,
        batch_id: null,
        rider_id: null,
        rider_user_id: null,
        sequence: null,
      });
      await insert("delivery_provider_dispatch", {
        id,
        delivery_job_id: id,
        method: "MANUAL",
        provider: null,
        merchant_order_id: id,
        request_hash: "manual-request",
        request_snapshot_json: "{}",
        status: "PENDING",
        manual_reason: "No courier available",
        manual_person_name: "Test courier",
        manual_phone_e164: "+639171234567",
        client_idempotency_key: id,
        created_at: 1,
        updated_at: 1,
      });
      await env.DB.prepare("UPDATE delivery_provider_dispatch SET status='COMPLETED' WHERE id=?")
        .bind(id)
        .run();
      expect(
        await env.DB.prepare(
          "SELECT status,handed_over_at,completed_at FROM delivery_provider_dispatch WHERE id=?",
        )
          .bind(id)
          .first(),
      ).toEqual({ status: "COMPLETED", handed_over_at: null, completed_at: null });
    },
  );

  it("preserves attempt history, one active attempt, assignment structure and consistent timestamps", async () => {
    const job = await first("delivery_job");
    const makeJob = async (scheduled: boolean) => {
      const id = crypto.randomUUID();
      await seedTestInstantOrder(env.DB, id);
      if (scheduled)
        await env.DB.prepare(
          "UPDATE grocery_order SET fulfillment_mode='SCHEDULED',cycle_id='cycle-next-cebu' WHERE id=?",
        )
          .bind(id)
          .run();
      await insert("delivery_job", {
        ...job,
        id,
        order_id: id,
        cycle_id: scheduled ? "cycle-next-cebu" : null,
        fulfillment_mode: scheduled ? "SCHEDULED" : "INSTANT",
        batch_id: null,
        rider_id: null,
        rider_user_id: null,
        sequence: null,
      });
      return id;
    };
    const manual = (jobId: string): Row => ({
      id: crypto.randomUUID(),
      delivery_job_id: jobId,
      attempt_sequence: 1,
      method: "MANUAL",
      provider: null,
      merchant_order_id: crypto.randomUUID(),
      request_hash: "manual-request",
      request_snapshot_json: "{}",
      status: "ACTIVE",
      manual_reason: "No courier available",
      manual_person_name: "Test courier",
      manual_phone_e164: "+639171234567",
      client_idempotency_key: crypto.randomUUID(),
      created_at: 1,
      updated_at: 1,
    });
    const assignment = manual(await makeJob(true));
    const invalidAssignments: Row[] = [
      { manual_reason: null },
      { manual_person_name: null },
      { manual_phone_e164: "+63abcdefghi" },
      { provider: "lalamove" },
    ];
    for (const invalid of invalidAssignments) {
      await expect(
        insert("delivery_provider_dispatch", { ...assignment, ...invalid }),
      ).rejects.toThrow(/CHECK/);
    }
    await insert("delivery_provider_dispatch", assignment);
    const replacement: Row = {
      ...assignment,
      id: crypto.randomUUID(),
      attempt_sequence: 2,
      method: "EXTERNAL",
      provider: "lalamove",
      manual_reason: null,
      manual_person_name: null,
      manual_phone_e164: null,
      merchant_order_id: crypto.randomUUID(),
      client_idempotency_key: crypto.randomUUID(),
    };
    await expect(insert("delivery_provider_dispatch", replacement)).rejects.toThrow(
      /UNIQUE.*delivery_job_id/,
    );
    await expect(
      env.DB.prepare(
        "UPDATE delivery_provider_dispatch SET handed_over_at=3,completed_at=2 WHERE id=?",
      )
        .bind(assignment.id)
        .run(),
    ).rejects.toThrow(/CHECK/);
    await env.DB.prepare(
      "UPDATE delivery_provider_dispatch SET status='FAILED',handed_over_at=2 WHERE id=?",
    )
      .bind(assignment.id)
      .run();
    await insert("delivery_provider_dispatch", replacement);
    await expect(
      env.DB.prepare(
        "UPDATE delivery_provider_dispatch SET manual_person_name='Replacement' WHERE id=?",
      )
        .bind(assignment.id)
        .run(),
    ).rejects.toThrow(/IDENTITY_IMMUTABLE/);
    await expect(
      env.DB.prepare("DELETE FROM delivery_provider_dispatch WHERE id=?").bind(assignment.id).run(),
    ).rejects.toThrow(/HISTORY_IMMUTABLE/);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(assignment.delivery_job_id)
        .first(),
    ).toEqual({ count: 2 });
  });
  it("rejects fractional, textual, unsafe and impossible stock/money, while preserving signed ledger movements", async () => {
    for (const value of [-1, 0.5, "not-a-number", Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        env.DB.prepare(
          "UPDATE inventory_balance SET on_hand=? WHERE location_id='location-cebu-central'",
        )
          .bind(value)
          .run(),
      ).rejects.toThrow(/constraint|cannot store/i);
    }
    await expect(
      env.DB.prepare("UPDATE inventory_balance SET reserved=on_hand+1").run(),
    ).rejects.toThrow(/reserved <= on_hand/);
    const payment = await first("payment_intent");
    for (const amount of [0.5, -1, "invalid", Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        insert("payment_intent", {
          ...payment,
          id: crypto.randomUUID(),
          idempotency_key: crypto.randomUUID(),
          amount_minor: amount,
        }),
      ).rejects.toThrow(/constraint|cannot store/i);
    }
    await expect(
      insert("payment_intent", { ...payment, id: null, idempotency_key: crypto.randomUUID() }),
    ).rejects.toThrow(/NOT NULL/);
    const ledger = await first("inventory_ledger_entries");
    await insert("inventory_ledger_entries", {
      ...ledger,
      id: crypto.randomUUID(),
      idempotency_key: crypto.randomUUID(),
      quantity_delta_base: -1,
    });
    const item = await first("order_item");
    await expect(
      insert("order_item", { ...item, id: crypto.randomUUID(), quantity: 0 }),
    ).rejects.toThrow(/quantity > 0/);
  });

  it("requires every exact Scheduled field on both INSERT and UPDATE", async () => {
    const demand = await first("committed_demand");
    const item = await env.DB.prepare("SELECT * FROM order_item WHERE order_id=? LIMIT 1")
      .bind(demand.order_id)
      .first<Row>();
    if (!item) throw new Error("Missing demand line");
    const lineId = crypto.randomUUID();
    await insert("order_item", { ...item, id: lineId });
    const valid: Row = {
      ...demand,
      id: crypto.randomUUID(),
      demand_basis: "EXACT_PAID_LINE",
      order_item_id: lineId,
      amendment_line_id: null,
      sku_id: item.sku_id,
      quantity_sellable: 1,
      quantity_base_total: demand.quantity,
      base_unit_code: "GRAM",
      shipping_weight_grams: 500,
      committed_at: 1,
    };
    for (const column of [
      "sku_id",
      "quantity_sellable",
      "quantity_base_total",
      "quantity",
      "base_unit_code",
      "shipping_weight_grams",
      "committed_at",
      "order_item_id",
    ]) {
      await insert("committed_demand", valid);
      await expect(
        env.DB.prepare(`UPDATE committed_demand SET ${identifier(column)}=NULL WHERE id=?`)
          .bind(valid.id)
          .run(),
      ).rejects.toThrow(/EXACT_SCHEDULED|CHECK constraint|NOT NULL/);
      await env.DB.prepare("DELETE FROM committed_demand WHERE id=?").bind(valid.id).run();
      await expect(insert("committed_demand", { ...valid, [column]: null })).rejects.toThrow(
        /EXACT_SCHEDULED|CHECK constraint|NOT NULL/,
      );
    }
    const requirement = await first("procurement_requirement");
    const runId = crypto.randomUUID();
    await insert("procurement_run", {
      id: runId,
      delivery_cycle_id: requirement.delivery_cycle_id,
      destination_location_id: requirement.location_id,
      status: "DRAFT",
      demand_version: 1,
      version: 1,
      created_at: 1,
      updated_at: 1,
    });
    const exact: Row = {
      ...requirement,
      id: crypto.randomUUID(),
      calculation_basis: "EXACT_PAID_DEMAND",
      procurement_run_id: runId,
      sku_id: item.sku_id,
      committed_quantity_sellable: 1,
      committed_demand_base: requirement.required_quantity,
      required_base: requirement.required_quantity,
      shipping_weight_grams: 500,
    };
    for (const column of [
      "procurement_run_id",
      "sku_id",
      "committed_quantity_sellable",
      "committed_demand_base",
      "required_base",
      "required_quantity",
      "shipping_weight_grams",
    ]) {
      await insert("procurement_requirement", exact);
      await expect(
        env.DB.prepare(`UPDATE procurement_requirement SET ${identifier(column)}=NULL WHERE id=?`)
          .bind(exact.id)
          .run(),
      ).rejects.toThrow(/EXACT_PROCUREMENT|CHECK constraint|NOT NULL/);
      await env.DB.prepare("DELETE FROM procurement_requirement WHERE id=?").bind(exact.id).run();
      await expect(insert("procurement_requirement", { ...exact, [column]: null })).rejects.toThrow(
        /EXACT_PROCUREMENT|CHECK constraint|NOT NULL/,
      );
    }
  });

  it("rejects orphan operational parents and invalid pickup phones", async () => {
    for (const [table, column] of [
      ["inventory_reservation", "location_id"],
      ["inventory_reservation", "inventory_pool_id"],
      ["delivery_job", "order_id"],
      ["order_fulfillment_snapshot", "order_id"],
      ["receiving_record", "procurement_requirement_id"],
    ]) {
      const row = await first(table);
      const identity = table === "order_fulfillment_snapshot" ? "order_id" : "id";
      await expect(
        env.DB.prepare(
          `UPDATE ${identifier(table)} SET ${identifier(column)}='missing-parent' WHERE ${identifier(identity)}=?`,
        )
          .bind(row[identity])
          .run(),
      ).rejects.toThrow(/FOREIGN KEY/);
    }
    await expect(
      env.DB.prepare(
        "UPDATE fulfillment_location_delivery_profile SET phone_e164='+63abcdefghi'",
      ).run(),
    ).rejects.toThrow(/CHECK constraint/);
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it("has one provider payment identity and one Product pool ownership pointer", async () => {
    const attempt = await env.DB.prepare(
      "SELECT * FROM payment_attempt WHERE provider_reference IS NOT NULL LIMIT 1",
    ).first<Row>();
    if (!attempt) throw new Error("Missing provider payment fixture");
    await expect(
      insert("payment_attempt", {
        ...attempt,
        id: crypto.randomUUID(),
        idempotency_key: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/UNIQUE.*provider/);
    for (const [table, removed] of [
      ["inventory_pool", "product_id"],
      ["payment_refund", "canonical_status"],
      ["service_fee_configuration", "active_for_new_commerce"],
    ]) {
      const columns = await env.DB.prepare(`PRAGMA table_info(${identifier(table)})`).all<{
        name: string;
      }>();
      expect(columns.results.some((column) => column.name === removed)).toBe(false);
    }
    const product = await first("product");
    await expect(
      insert("product", { ...product, id: crypto.randomUUID(), slug: crypto.randomUUID() }),
    ).rejects.toThrow(/UNIQUE.*inventory_pool_id/);
    const tables = await env.DB.prepare("PRAGMA table_list").all<{
      name: string;
      strict: number;
    }>();
    expect(tables.results.find((table) => table.name === "payment_intent")?.strict).toBe(1);
    expect(tables.results.find((table) => table.name === "user")?.strict).toBe(0);
  });
});
