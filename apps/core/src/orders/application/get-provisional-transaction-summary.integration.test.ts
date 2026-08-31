import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  getProvisionalTransactionSummary,
  toProvisionalTransactionSummary,
} from "./get-provisional-transaction-summary";

describe("provisional transaction summary", () => {
  it("conceals ownership and labels legacy totals without inventing invoice facts", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `summary-customer-${suffix}`;
    const otherCustomerId = `summary-other-${suffix}`;
    const orderId = `summary-order-${suffix}`;
    const intentId = `summary-intent-${suffix}`;
    const attemptId = `summary-attempt-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(otherCustomerId, `auth-${otherCustomerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO payment_intent (id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100000,'PHP','SUCCEEDED',?,1,?,?)",
      ).bind(intentId, `quote-${suffix}`, customerId, `intent-${suffix}`, now, now),
      env.DB.prepare(
        "INSERT INTO payment_attempt (id,customer_id,payment_intent_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,?,100000,'PHP','SUCCEEDED','mock',?,?,?)",
      ).bind(attemptId, customerId, intentId, `attempt-${suffix}`, now, now),
      env.DB.prepare(
        `INSERT INTO grocery_order
         (id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at,order_number,committed_at)
         VALUES (?,?,NULL,'INSTANT','{"recipient":"Ana","city":"Cebu City"}','COMMITTED',100000,'PHP',?,1,?,'FM-SUMMARY-1',?)`,
      ).bind(orderId, customerId, attemptId, now, now),
    ]);

    const hidden = await getProvisionalTransactionSummary(env.DB, {
      customerId: otherCustomerId,
      orderId,
      requestId: "summary-hidden",
    });
    expect(hidden).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    const visible = await getProvisionalTransactionSummary(env.DB, {
      customerId,
      orderId,
      requestId: "summary-visible",
    });
    expect(visible).toMatchObject({
      ok: true,
      value: {
        documentKind: "PROVISIONAL_TRANSACTION_SUMMARY",
        disclaimer: "NOT AN OFFICIAL BIR INVOICE",
        financial: { source: "ORDER_TOTAL_ONLY", totalMinor: 100_000 },
        officialInvoice: { status: "NOT_READY", identifier: null },
      },
    });
    if (!visible.ok) return;
    const withInstantFee = toProvisionalTransactionSummary({
      ...(await import("./get-customer-order-detail").then(async ({ getCustomerOrderDetail }) => {
        const detail = await getCustomerOrderDetail(env.DB, {
          customerId,
          orderId,
          requestId: "summary-transform",
        });
        if (!detail.ok) throw new Error(detail.error.message);
        return detail.value;
      })),
      financial: {
        ...visible.value.financial,
        source: "CHECKOUT_QUOTE",
        serviceFeeMinor: 2_500,
      },
    });
    expect(withInstantFee.financial.serviceFeeMinor).toBe(2_500);
    expect(JSON.stringify(withInstantFee)).not.toMatch(/sellerTin|officialSerial|taxPolicy/i);
  });
});
