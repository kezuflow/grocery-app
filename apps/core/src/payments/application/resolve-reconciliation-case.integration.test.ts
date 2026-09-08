import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createPayment } from "./create-payment";
import { reconcilePayment } from "./reconcile-payment";
import {
  createMockPaymentProvider,
  setMockObservedState,
} from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";

import { resolveReconciliationCase } from "./resolve-reconciliation-case";
import { locationManager } from "../../test-location-fixtures";
const sharedMock = createMockPaymentProvider();
function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [sharedMock]);
}

let customerIdCounter = 0;
async function seedCustomer(): Promise<string> {
  const id = `cust-rec-${++customerIdCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

async function seededIntent() {
  const created = await createPayment(env.DB, testRegistry(), {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_attempt",
    subjectId: `ca-${crypto.randomUUID()}`,
    customerId: await seedCustomer(),
    amountMinor: 15000,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/return",
    idempotencyKey: `rec-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("fixture failed");
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(created.value.paymentIntentId)
    .first<{ provider_reference: string }>();
  if (!attempt) throw new Error("Missing provider fixture");
  return { intentId: created.value.paymentIntentId, reference: attempt.provider_reference };
}

async function reviewFixture() {
  const paid = await seededIntent();
  const lookup = vi
    .spyOn(sharedMock, "getPayment")
    .mockRejectedValueOnce(new Error("provider timeout"));
  const lookupCommand = {
    paymentIntentId: paid.intentId,
    idempotencyKey: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    actorId: "system:scheduler",
  };
  await reconcilePayment(env.DB, testRegistry(), lookupCommand);
  lookup.mockRestore();
  setMockObservedState(sharedMock, paid.reference, "FAILED");
  await reconcilePayment(env.DB, testRegistry(), lookupCommand);
  const record = await env.DB.prepare(
    "SELECT id,version FROM payment_reconciliation_case WHERE payment_intent_id=?",
  )
    .bind(paid.intentId)
    .first<{ id: string; version: number }>();
  const manager = await locationManager("global");
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='refunds.manage'",
  )
    .bind(manager.id)
    .run();
  const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
    .bind(manager.id)
    .first<{ auth_user_id: string }>();
  if (!record || !actor) throw new Error("Missing review fixture");
  return {
    ...paid,
    manager,
    command: {
      caseId: record.id,
      expectedVersion: record.version,
      reason: "Provider confirmed the failed payment",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      actorAuthUserId: actor.auth_user_id,
    },
  };
}
describe("guarded financial exception resolution", () => {
  it("keeps financial review open until a related verified provider event is applied", async () => {
    const f = await reviewFixture();
    const { extendPaymentRepository } = await import("../infrastructure/d1/payment-repository");
    const repository = extendPaymentRepository(env.DB);
    const eventId = crypto.randomUUID();
    const now = Date.now();
    // Explicit retained-inbox seam: the preceding real lookup has confirmed FAILED,
    // but delivery of that same provider outcome still has unapplied local work.
    await repository.insertInbox({
      provider: "mock",
      providerEventId: eventId,
      providerReference: f.reference,
      eventType: "payment",
      payloadHash: "retained-observation",
      rawPayload: "retained-test-receipt",
      now,
      signatureVerifiedAt: now,
      normalizedObservationJson: JSON.stringify({
        kind: "payment",
        provider: "mock",
        providerEventId: eventId,
        providerReference: f.reference,
        canonicalState: "FAILED",
        amountMinor: 15000,
        currency: "PHP",
        refundReference: null,
        observedAt: now,
        payloadHash: "retained-observation",
      }),
    });
    expect(await resolveReconciliationCase(env.DB, f.command)).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT status,version FROM payment_reconciliation_case WHERE id=?")
        .bind(f.command.caseId)
        .first(),
    ).toEqual({ status: "OPEN", version: f.command.expectedVersion });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.RECONCILIATION_RESOLVED'",
      )
        .bind(f.command.caseId)
        .first(),
    ).toEqual({ n: 0 });
    const { redriveProviderInbox } = await import("./redrive-provider-inbox");
    expect(await redriveProviderInbox(env.DB, { now: now + 1 })).toMatchObject({ applied: 1 });
    expect(await resolveReconciliationCase(env.DB, f.command)).toMatchObject({ ok: true });
  });
  it("resolves only after real provider recovery and preserves the original receipt after a later reopening", async () => {
    const f = await reviewFixture();
    const accepted = await resolveReconciliationCase(env.DB, f.command);
    expect(accepted).toMatchObject({
      ok: true,
      value: { caseId: f.command.caseId, status: "RESOLVED", version: 2 },
    });
    await env.DB.prepare(
      "UPDATE payment_reconciliation_case SET status='OPEN',resolved_at=NULL,version=version+1 WHERE id=?",
    )
      .bind(f.command.caseId)
      .run();
    expect(await resolveReconciliationCase(env.DB, f.command)).toEqual(accepted);
    expect(
      await resolveReconciliationCase(env.DB, { ...f.command, reason: "changed" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.RECONCILIATION_RESOLVED'",
      )
        .bind(f.command.caseId)
        .first(),
    ).toEqual({ n: 1 });
  });
  it.each(["scope", "version", "financial", "inbox", "audit"] as const)(
    "rejects a transaction-time %s change with no partial closure",
    async (kind) => {
      const f = await reviewFixture();
      const database = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (kind === "scope")
                await target
                  .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                  .bind(f.manager.id)
                  .run();
              if (kind === "version")
                await target
                  .prepare("UPDATE payment_reconciliation_case SET version=version+1 WHERE id=?")
                  .bind(f.command.caseId)
                  .run();
              if (kind === "financial")
                await target
                  .prepare(
                    "UPDATE payment_intent SET status='PROCESSING',version=version+1 WHERE id=?",
                  )
                  .bind(f.intentId)
                  .run();
              if (kind === "inbox") {
                const { extendPaymentRepository } =
                  await import("../infrastructure/d1/payment-repository");
                await extendPaymentRepository(target).insertInbox({
                  provider: "mock",
                  providerEventId: crypto.randomUUID(),
                  providerReference: f.reference,
                  eventType: "payment",
                  payloadHash: "concurrent-inbox",
                  normalizedObservationJson: "{}",
                  rawPayload: "explicit-concurrent-receipt",
                  signatureVerifiedAt: Date.now(),
                  now: Date.now(),
                });
              }
              return target.batch(
                kind === "audit"
                  ? [...statements, target.prepare("INSERT INTO commitment_abort(id) VALUES (-42)")]
                  : statements,
              );
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(await resolveReconciliationCase(database, f.command)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(
        await env.DB.prepare(
          "SELECT status,resolved_at FROM payment_reconciliation_case WHERE id=?",
        )
          .bind(f.command.caseId)
          .first(),
      ).toEqual({ status: "OPEN", resolved_at: null });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM idempotency_records WHERE scope='admin.payments.reconcile' AND idempotency_key=?",
        )
          .bind(f.command.idempotencyKey)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.RECONCILIATION_RESOLVED'",
        )
          .bind(f.command.caseId)
          .first(),
      ).toEqual({ n: 0 });
    },
  );
  it("admits one competing resolution and rejects an unauthorised replay", async () => {
    const f = await reviewFixture();
    const results = await Promise.all([
      resolveReconciliationCase(env.DB, f.command),
      resolveReconciliationCase(env.DB, { ...f.command, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    await env.DB.prepare("UPDATE staff_identity SET status='suspended' WHERE id=?")
      .bind(f.manager.id)
      .run();
    expect(await resolveReconciliationCase(env.DB, f.command)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
