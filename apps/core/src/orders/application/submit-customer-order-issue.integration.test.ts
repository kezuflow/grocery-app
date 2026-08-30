import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { listCustomerOrderIssues } from "./list-customer-order-issues";
import { submitCustomerOrderIssue } from "./submit-customer-order-issue";

async function fixture() {
  const suffix = crypto.randomUUID();
  const customerId = `issue-customer-${suffix}`;
  const otherCustomerId = `issue-other-${suffix}`;
  const orderId = `issue-order-${suffix}`;
  const paymentId = `issue-payment-${suffix}`;
  const itemId = `issue-item-${suffix}`;
  const now = Date.now();
  const cycle = await env.DB.prepare("SELECT id FROM delivery_cycle LIMIT 1").first<{
    id: string;
  }>();
  if (!cycle) throw new Error("Expected delivery cycle");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(customerId, `auth-${customerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(otherCustomerId, `auth-${otherCustomerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 10000, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?)",
    ).bind(paymentId, customerId, `issue-payment-key-${suffix}`, now, now),
    env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, version, created_at, order_number, committed_at) VALUES (?, ?, ?, 'SCHEDULED', '{}', 'DELIVERED', 10000, 'PHP', ?, 4, ?, ?, ?)",
    ).bind(orderId, customerId, cycle.id, paymentId, now, `FM-ISSUE-${suffix.slice(0, 8)}`, now),
    env.DB.prepare(
      "INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) VALUES (?, ?, 'sku-red-onion-500g', 'Red onion', '500 g', 'pack', 1, 10000, 10000, 500)",
    ).bind(itemId, orderId),
  ]);
  return { customerId, otherCustomerId, orderId, itemId, now };
}

describe("customer order issue application", () => {
  it("submits linked lines idempotently without payment/refund/order mutation", async () => {
    const data = await fixture();
    const before = await env.DB.prepare(
      "SELECT version, (SELECT COUNT(*) FROM payment_refund) refunds FROM grocery_order WHERE id=?",
    )
      .bind(data.orderId)
      .first<{ version: number; refunds: number }>();
    const command = {
      customerId: data.customerId,
      orderId: data.orderId,
      category: "POOR_QUALITY" as const,
      description: "The onions arrived bruised and soft.",
      affectedOrderItemIds: [data.itemId],
      idempotencyKey: `issue-${crypto.randomUUID()}`,
      requestId: "submit-issue",
      headers: {},
    };
    const submitted = await submitCustomerOrderIssue(env.DB, command);
    const replay = await submitCustomerOrderIssue(env.DB, command);
    const conflict = await submitCustomerOrderIssue(env.DB, {
      ...command,
      description: "A different issue under the same key.",
    });
    const after = await env.DB.prepare(
      "SELECT version, (SELECT COUNT(*) FROM payment_refund) refunds, (SELECT COUNT(*) FROM order_issue_line WHERE issue_id=?) lines FROM grocery_order WHERE id=?",
    )
      .bind(submitted.ok ? submitted.value.issueId : "missing", data.orderId)
      .first<{ version: number; refunds: number; lines: number }>();

    expect(submitted).toMatchObject({
      ok: true,
      value: {
        orderId: data.orderId,
        category: "POOR_QUALITY",
        status: "SUBMITTED",
        affectedOrderItemIds: [data.itemId],
        terminal: false,
      },
    });
    expect(replay).toEqual(submitted);
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(after).toEqual({ version: before?.version, refunds: before?.refunds, lines: 1 });
  });

  it("conceals ownership and rejects affected lines outside the order", async () => {
    const data = await fixture();
    const wrongOwner = await submitCustomerOrderIssue(env.DB, {
      customerId: data.otherCustomerId,
      orderId: data.orderId,
      category: "POOR_QUALITY",
      description: "This should not reveal the order.",
      affectedOrderItemIds: [data.itemId],
      idempotencyKey: `wrong-owner-${crypto.randomUUID()}`,
      requestId: "wrong-owner",
      headers: {},
    });
    const wrongLine = await submitCustomerOrderIssue(env.DB, {
      customerId: data.customerId,
      orderId: data.orderId,
      category: "MISSING_ITEM",
      description: "A line from another order was supplied.",
      affectedOrderItemIds: ["not-this-order"],
      idempotencyKey: `wrong-line-${crypto.randomUUID()}`,
      requestId: "wrong-line",
      headers: {},
    });
    expect(wrongOwner).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(wrongLine).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("lists controlled customer status and resolution copy without Admin fields", async () => {
    const data = await fixture();
    const issueId = `resolved-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO order_issue (id, order_id, customer_id, category, status, details, assigned_staff_id, resolution, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'DELIVERY', 'RESOLVED', 'Late arrival', NULL, 'Internal staff-only resolution', 3, ?, ?, ?)",
    )
      .bind(
        issueId,
        data.orderId,
        data.customerId,
        `resolved-key-${issueId}`,
        data.now,
        data.now + 10,
      )
      .run();
    const result = await listCustomerOrderIssues(env.DB, {
      customerId: data.customerId,
      orderId: data.orderId,
      requestId: "list-issues",
    });
    const hidden = await listCustomerOrderIssues(env.DB, {
      customerId: data.otherCustomerId,
      orderId: data.orderId,
      requestId: "list-hidden",
    });

    expect(result).toMatchObject({
      ok: true,
      value: [{ category: "DELIVERY_ISSUE", status: "RESOLVED", terminal: true }],
    });
    if (result.ok) {
      expect(result.value[0]?.resolutionMessage).toBe("Our team marked this issue resolved.");
      expect(JSON.stringify(result.value)).not.toMatch(/staff|Internal staff-only|refund|admin/i);
    }
    expect(hidden).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});
