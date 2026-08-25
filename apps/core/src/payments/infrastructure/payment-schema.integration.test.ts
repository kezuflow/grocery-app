import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

async function tableColumns(table: string): Promise<string[]> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

describe("payments context persistence", () => {
  it("creates the canonical payments tables with the declared columns", async () => {
    expect(await tableColumns("payment_intent")).toEqual(
      expect.arrayContaining([
        "id",
        "purpose",
        "subject_type",
        "subject_id",
        "customer_id",
        "amount_minor",
        "currency",
        "status",
        "idempotency_key",
        "version",
        "created_at",
        "updated_at",
      ]),
    );
    expect((await tableColumns("payment_provider_customer")).length).toBeGreaterThan(0);
    expect((await tableColumns("payment_provider_method")).length).toBeGreaterThan(0);
    expect(await tableColumns("payment_provider_event_inbox")).toEqual(
      expect.arrayContaining([
        "provider",
        "provider_event_id",
        "payload_hash",
        "processing_status",
      ]),
    );
    expect(await tableColumns("payment_reaction")).toEqual(
      expect.arrayContaining([
        "id",
        "payment_intent_id",
        "reaction_type",
        "subject_type",
        "subject_id",
        "status",
        "idempotency_key",
        "attempts",
        "last_error_code",
        "available_at",
      ]),
    );
    expect(await tableColumns("payment_reconciliation_case")).toEqual(
      expect.arrayContaining(["id", "payment_intent_id", "category", "status", "details_json"]),
    );
    expect(await tableColumns("payment_attempt")).toContain("payment_intent_id");
  });

  it("deduplicates provider events on (provider, provider_event_id)", async () => {
    const insert = () =>
      env.DB.prepare(
        "INSERT INTO payment_provider_event_inbox (id, provider, provider_event_id, payload_hash, processing_status, received_at, updated_at) VALUES (?, 'fake', 'evt-dup', 'hash-a', 'RECEIVED', ?, ?)",
      )
        .bind(crypto.randomUUID(), Date.now(), Date.now())
        .run();
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it("rejects negative intent amounts and non-canonical purposes or statuses", async () => {
    const base = {
      purpose: "GROCERY_CHECKOUT",
      subjectType: "checkout_attempt",
      subjectId: "subj-1",
      customerId: "cust-1",
      amountMinor: 100,
      currency: "PHP",
      status: "INITIATED",
      idempotencyKey: `pi-${crypto.randomUUID()}`,
    };
    const insert = (overrides: Partial<typeof base>) => {
      const row = { ...base, ...overrides };
      return env.DB.prepare(
        "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          row.purpose,
          row.subjectType,
          row.subjectId,
          row.customerId,
          row.amountMinor,
          row.currency,
          row.status,
          row.idempotencyKey,
          Date.now(),
          Date.now(),
        )
        .run();
    };
    await insert({});
    await expect(insert({ amountMinor: -1 })).rejects.toThrow();
    await expect(insert({ purpose: "VENDOR_THING" })).rejects.toThrow();
    await expect(insert({ status: "CAPTURED" })).rejects.toThrow();
  });

  it("enforces unique reaction idempotency keys", async () => {
    const intentId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'MEMBERSHIP_ENROLLMENT', 'subscription', 'sub-1', 'cust-2', 29900, 'PHP', 'INITIATED', ?, 1, ?, ?)",
    )
      .bind(intentId, `pi-${crypto.randomUUID()}`, Date.now(), Date.now())
      .run();
    const insertReaction = () =>
      env.DB.prepare(
        "INSERT INTO payment_reaction (id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, available_at, created_at, updated_at) VALUES (?, ?, 'ACTIVATE_MEMBERSHIP', 'subscription', 'sub-1', 'PENDING', ?, 0, ?, ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          intentId,
          "reaction-fixed-key",
          Date.now(),
          Date.now(),
          Date.now(),
        )
        .run();
    await insertReaction();
    await expect(insertReaction()).rejects.toThrow();
  });
});
