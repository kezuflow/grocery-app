import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createPayment } from "./create-payment";
import {
  createMockPaymentProvider,
  setMockObservedState,
} from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { reconcilePayment } from "./reconcile-payment";
import { redrivePaymentReactions } from "./redrive-payment-reactions";
import { retryPaymentReaction } from "./retry-payment-reaction";
import { requestRefund } from "./request-refund";

async function fixture() {
  const id = crypto.randomUUID(),
    now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
  )
    .bind(id, id, now, now)
    .run();
  const provider = createMockPaymentProvider(),
    registry = new ProviderRegistry("test", [provider]);
  const created = await createPayment(env.DB, registry, {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_quote",
    subjectId: id,
    customerId: id,
    amountMinor: 1000,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/return",
    idempotencyKey: id,
    requestId: id,
  });
  if (!created.ok) throw new Error("Payment creation failed");
  const paymentId = created.value.paymentIntentId;
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(paymentId)
    .first<{ provider_reference: string }>();
  if (!attempt) throw new Error("Missing provider attempt");
  setMockObservedState(provider, attempt.provider_reference, "SUCCEEDED");
  expect(
    await reconcilePayment(env.DB, registry, {
      paymentIntentId: paymentId,
      idempotencyKey: crypto.randomUUID(),
      actorId: "system:test",
      requestId: id,
    }),
  ).toMatchObject({ ok: true });
  const reaction = await env.DB.prepare("SELECT id FROM payment_reaction WHERE payment_intent_id=?")
    .bind(paymentId)
    .first<{ id: string }>();
  if (!reaction) throw new Error("Missing canonical paid reaction");
  // Exhausted attempt count is a retained-state seam; actual scheduler produces escalation.
  await env.DB.prepare("UPDATE payment_reaction SET attempts=5,available_at=? WHERE id=?")
    .bind(now - 1, reaction.id)
    .run();
  expect(await redrivePaymentReactions(env.DB, registry, Date.now())).toMatchObject({
    escalated: 1,
  });
  const record = await env.DB.prepare(
    "SELECT id,version FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REACTION_FAILURE'",
  )
    .bind(paymentId)
    .first<{ id: string; version: number }>();
  const payment = await env.DB.prepare("SELECT version FROM payment_intent WHERE id=?")
    .bind(paymentId)
    .first<{ version: number }>();
  const manager = await locationManager("global");
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='payments.manage'",
  )
    .bind(manager.id)
    .run();
  const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
    .bind(manager.id)
    .first<{ auth_user_id: string }>();
  if (!record || !payment || !actor) throw new Error("Missing recovery fixture");
  return {
    paymentId,
    reactionId: reaction.id,
    manager,
    registry,
    command: {
      caseId: record.id,
      expectedVersion: record.version,
      expectedPaymentVersion: payment.version,
      reason: "Reviewed local commitment readiness",
      idempotencyKey: crypto.randomUUID(),
      actorAuthUserId: actor.auth_user_id,
      requestId: crypto.randomUUID(),
    },
  };
}
describe("reviewed commerce reaction retry", () => {
  it("preserves the receipt and admits one competing request without inventing a missing Order", async () => {
    const f = await fixture();
    const accepted = await retryPaymentReaction(env.DB, f.command);
    expect(accepted).toMatchObject({ ok: true });
    expect(await retryPaymentReaction(env.DB, f.command)).toEqual(accepted);
    expect(await retryPaymentReaction(env.DB, { ...f.command, reason: "changed" })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(
      await retryPaymentReaction(env.DB, { ...f.command, idempotencyKey: crypto.randomUUID() }),
    ).toMatchObject({ ok: false });
    expect(await redrivePaymentReactions(env.DB, f.registry, Date.now())).toMatchObject({
      applied: 0,
      retried: 1,
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM order_payment_reaction WHERE payment_intent_id=?",
      )
        .bind(f.paymentId)
        .first(),
    ).toEqual({ n: 0 });
    expect(await retryPaymentReaction(env.DB, f.command)).toEqual(accepted);
    await env.DB.prepare("UPDATE staff_identity SET status='suspended' WHERE id=?")
      .bind(f.manager.id)
      .run();
    expect(await retryPaymentReaction(env.DB, f.command)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
  it("admits only one concurrent retry", async () => {
    const f = await fixture();
    const results = await Promise.all([
      retryPaymentReaction(env.DB, f.command),
      retryPaymentReaction(env.DB, { ...f.command, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
  it("rejects current refund reservation and retired reaction policy", async () => {
    const f = await fixture();
    expect(
      await requestRefund(env.DB, f.registry, {
        paymentIntentId: f.paymentId,
        amountMinor: 1000,
        reason: "Finance review",
        actorId: f.command.actorAuthUserId,
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await retryPaymentReaction(env.DB, f.command)).toMatchObject({ ok: false });
    const retired = await fixture();
    await env.DB.prepare(
      "UPDATE payment_reaction SET reaction_type='ACTIVATE_MEMBERSHIP' WHERE id=?",
    )
      .bind(retired.reactionId)
      .run();
    expect(await retryPaymentReaction(env.DB, retired.command)).toMatchObject({ ok: false });
  });
  it.each(["authority", "payment", "lease", "audit"] as const)(
    "guards a transaction-time %s change without partial retry",
    async (kind) => {
      const f = await fixture();
      if (kind === "audit")
        await env.DB.exec(
          "CREATE TRIGGER ignore_reaction_retry_audit BEFORE INSERT ON audit_event WHEN NEW.action='PAYMENT.REACTION_RETRY_REQUESTED' BEGIN SELECT RAISE(IGNORE); END",
        );
      try {
        const db = new Proxy(env.DB, {
          get(target, key) {
            if (key === "batch")
              return async (statements: D1PreparedStatement[]) => {
                if (kind === "authority")
                  await target
                    .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                    .bind(f.manager.id)
                    .run();
                if (kind === "payment")
                  await target
                    .prepare("UPDATE payment_intent SET version=version+1 WHERE id=?")
                    .bind(f.paymentId)
                    .run();
                if (kind === "lease")
                  await target
                    .prepare("UPDATE payment_reaction SET available_at=? WHERE id=?")
                    .bind(Date.now() + 60000, f.reactionId)
                    .run();
                return target.batch(statements);
              };
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        expect(await retryPaymentReaction(db, f.command)).toMatchObject({
          ok: false,
          error: { code: "CONFLICT" },
        });
        expect(
          await env.DB.prepare("SELECT version FROM payment_reconciliation_case WHERE id=?")
            .bind(f.command.caseId)
            .first(),
        ).toEqual({ version: f.command.expectedVersion });
        expect(
          await env.DB.prepare("SELECT status,attempts FROM payment_reaction WHERE id=?")
            .bind(f.reactionId)
            .first(),
        ).toEqual({ status: "ESCALATED", attempts: 5 });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) n FROM idempotency_records WHERE scope='admin.payments.payment-reaction-retry' AND idempotency_key=?",
          )
            .bind(f.command.idempotencyKey)
            .first(),
        ).toEqual({ n: 0 });
      } finally {
        if (kind === "audit") await env.DB.exec("DROP TRIGGER ignore_reaction_retry_audit");
      }
    },
  );
});
