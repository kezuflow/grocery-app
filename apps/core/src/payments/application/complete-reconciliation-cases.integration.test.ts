import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createPayment } from "./create-payment";
import { reconcilePayment } from "./reconcile-payment";
import { completeResolvedReconciliationCases } from "./complete-reconciliation-cases";
import {
  createMockPaymentProvider,
  setMockObservedState,
} from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";

async function fixture() {
  const provider = createMockPaymentProvider();
  const registry = new ProviderRegistry("test", [provider]);
  const customerId = `auto-case-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  const created = await createPayment(env.DB, registry, {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_attempt",
    subjectId: crypto.randomUUID(),
    customerId,
    amountMinor: 15000,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/return",
    idempotencyKey: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
  });
  if (!created.ok) throw new Error("Payment fixture failed");
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(created.value.paymentIntentId)
    .first<{ provider_reference: string }>();
  if (!attempt) throw new Error("Attempt fixture missing");
  await env.DB.prepare(
    "INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) VALUES (?,?,'AMBIGUOUS_OUTCOME','OPEN','{}',?)",
  )
    .bind(`case-${crypto.randomUUID()}`, created.value.paymentIntentId, now)
    .run();
  setMockObservedState(provider, attempt.provider_reference, "FAILED");
  await reconcilePayment(env.DB, registry, {
    paymentIntentId: created.value.paymentIntentId,
    idempotencyKey: crypto.randomUUID(),
    actorId: "system:test",
    requestId: crypto.randomUUID(),
  });
  const record = await env.DB.prepare(
    "SELECT id,version FROM payment_reconciliation_case WHERE payment_intent_id=? ORDER BY created_at,id LIMIT 1",
  )
    .bind(created.value.paymentIntentId)
    .first<{ id: string; version: number }>();
  if (!record) throw new Error("Case fixture missing");
  return { paymentIntentId: created.value.paymentIntentId, caseId: record.id, now };
}

describe("automatic financial issue completion", () => {
  it("closes verified terminal work without staff acknowledgement and records its own receipt", async () => {
    const f = await fixture();
    expect(await completeResolvedReconciliationCases(env.DB, f.now + 1)).toMatchObject({
      completed: 1,
    });
    expect(
      await env.DB.prepare("SELECT status,version FROM payment_reconciliation_case WHERE id=?")
        .bind(f.caseId)
        .first(),
    ).toEqual({ status: "RESOLVED", version: 2 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.RECONCILIATION_AUTOMATICALLY_COMPLETED'",
      )
        .bind(f.caseId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE scope='system.payments.reconciliation-completion' AND result_reference=?",
      )
        .bind(f.caseId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("replays a completed sweep without duplicate case audits", async () => {
    const f = await fixture();
    await completeResolvedReconciliationCases(env.DB, f.now + 1);
    expect(await completeResolvedReconciliationCases(env.DB, f.now + 2)).toMatchObject({
      completed: 0,
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.RECONCILIATION_AUTOMATICALLY_COMPLETED'",
      )
        .bind(f.caseId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("keeps new provider work open and later completes it when that work is applied", async () => {
    const f = await fixture();
    const attempt = await env.DB.prepare(
      "SELECT provider,provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(f.paymentIntentId)
      .first<{ provider: string; provider_reference: string }>();
    if (!attempt) throw new Error("Attempt missing");
    await env.DB.prepare(
      "INSERT INTO payment_provider_event_inbox(id,provider,provider_event_id,payload_hash,processing_status,attempts,received_at,updated_at,provider_reference,event_type,available_at,raw_payload,signature_verified_at) VALUES (?,?,?,'hash','RETRY_REQUIRED',0,?,?,?,'payment.failed',?,'{}',?)",
    )
      .bind(
        crypto.randomUUID(),
        attempt.provider,
        crypto.randomUUID(),
        f.now,
        f.now,
        attempt.provider_reference,
        f.now,
        f.now,
      )
      .run();
    expect(await completeResolvedReconciliationCases(env.DB, f.now + 1)).toMatchObject({
      completed: 0,
    });
    await env.DB.prepare(
      "UPDATE payment_provider_event_inbox SET processing_status='APPLIED',processed_at=?,updated_at=? WHERE provider_reference=?",
    )
      .bind(f.now + 2, f.now + 2, attempt.provider_reference)
      .run();
    expect(await completeResolvedReconciliationCases(env.DB, f.now + 3)).toMatchObject({
      completed: 1,
    });
  });

  it("rolls back case completion when its audit is ignored", async () => {
    const f = await fixture();
    await env.DB.exec(
      "CREATE TRIGGER ignore_auto_case_audit BEFORE INSERT ON audit_event WHEN NEW.action='PAYMENT.RECONCILIATION_AUTOMATICALLY_COMPLETED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(await completeResolvedReconciliationCases(env.DB, f.now + 1)).toMatchObject({
        completed: 0,
      });
      expect(
        await env.DB.prepare("SELECT status,version FROM payment_reconciliation_case WHERE id=?")
          .bind(f.caseId)
          .first(),
      ).toEqual({ status: "OPEN", version: 1 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_auto_case_audit");
      await env.DB.prepare("DELETE FROM payment_reconciliation_case WHERE id=?")
        .bind(f.caseId)
        .run();
    }
  });

  it("uses distinct completion identities for multiple cases on one payment", async () => {
    const f = await fixture();
    const second = `case-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at) VALUES (?,?,'PROVIDER_TIMEOUT','OPEN','{}',?)",
    )
      .bind(second, f.paymentIntentId, f.now + 1)
      .run();
    expect(await completeResolvedReconciliationCases(env.DB, f.now + 2)).toMatchObject({
      completed: 2,
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE aggregate_id IN (?,?) AND action='PAYMENT.RECONCILIATION_AUTOMATICALLY_COMPLETED'",
      )
        .bind(f.caseId, second)
        .first(),
    ).toEqual({ count: 2 });
  });
});
