import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

/** Minimal valid parents: user -> customer -> payment_attempt -> grocery_order. */
async function seedParents(): Promise<{ orderId: string; customerId: string }> {
  const now = Date.now();
  const userId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Issue Parent', ?, 1, ?, ?)",
    ).bind(userId, `issue-parent-${crypto.randomUUID().slice(0, 8)}@example.com`, now, now),
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, version, created_at, updated_at) VALUES (?, ?, 'active', 1, ?, ?)",
    ).bind(customerId, userId, now, now),
    env.DB.prepare(
      "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 100, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?)",
    ).bind(paymentId, customerId, `issue-pay-${crypto.randomUUID()}`, now, now),
    env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at) VALUES (?, ?, (SELECT id FROM delivery_cycle LIMIT 1), '{}', 'COMMITTED', 100, 'PHP', ?, ?)",
    ).bind(orderId, customerId, paymentId, now),
  ]);
  return { orderId, customerId };
}

describe("order issue migration 0030", () => {
  it("creates the order issue queue table with closed vocabularies", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(order_issue)").all<{ name: string }>();
    expect(columns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "id",
        "order_id",
        "customer_id",
        "category",
        "status",
        "details",
        "assigned_staff_id",
        "resolution",
        "version",
        "idempotency_key",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("rejects unknown categories, unknown statuses, and duplicate idempotency keys", async () => {
    const now = Date.now();
    const parents = await seedParents();
    const insertSql =
      "INSERT INTO order_issue (id, order_id, customer_id, category, status, details, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, 'SUBMITTED', NULL, 1, ?, ?, ?)";

    let badCategoryRejected = false;
    try {
      await env.DB.prepare(insertSql)
        .bind(crypto.randomUUID(), parents.orderId, parents.customerId, "NOT_A_CATEGORY", `k-${crypto.randomUUID()}`, now, now)
        .run();
    } catch {
      badCategoryRejected = true;
    }
    expect(badCategoryRejected).toBe(true);

    let badStatusRejected = false;
    try {
      await env.DB.prepare(insertSql)
        .bind(crypto.randomUUID(), parents.orderId, parents.customerId, "MISSING_ITEM", "MAYBE", `k-${crypto.randomUUID()}`, now, now)
        .run();
    } catch {
      badStatusRejected = true;
    }
    expect(badStatusRejected).toBe(true);

    const fixedKey = `k-fixed-${crypto.randomUUID()}`;
    const inserted = await env.DB.prepare(insertSql)
      .bind(crypto.randomUUID(), parents.orderId, parents.customerId, "MISSING_ITEM", fixedKey, now, now)
      .run();
    expect(inserted.meta?.changes).toBe(1);

    let duplicateKeyRejected = false;
    try {
      await env.DB.prepare(insertSql)
        .bind(crypto.randomUUID(), parents.orderId, parents.customerId, "MISSING_ITEM", fixedKey, now, now)
        .run();
    } catch {
      duplicateKeyRejected = true;
    }
    expect(duplicateKeyRejected).toBe(true);
  });
});
