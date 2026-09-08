import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createPayment } from "./create-payment";
import { createMockPaymentProvider } from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { extendPaymentRepository } from "../infrastructure/d1/payment-repository";
import { redriveProviderInbox } from "./redrive-provider-inbox";
import { retryProviderEvent } from "./retry-provider-event";
import { readProviderEventRecovery } from "./read-provider-event-recovery";

async function fixture() {
  const id = crypto.randomUUID(),
    now = Date.now(),
    receivedAt = now - 25 * 60 * 60 * 1000;
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
  )
    .bind(id, id, now, now)
    .run();
  const created = await createPayment(
    env.DB,
    new ProviderRegistry("test", [createMockPaymentProvider()]),
    {
      purpose: "GROCERY_CHECKOUT",
      subjectType: "checkout_attempt",
      subjectId: id,
      customerId: id,
      amountMinor: 1000,
      currency: "PHP",
      providerCode: "mock",
      returnUrl: "https://app.example/return",
      idempotencyKey: id,
      requestId: id,
    },
  );
  if (!created.ok) throw new Error("Payment fixture failed");
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(created.value.paymentIntentId)
    .first<{ provider_reference: string }>();
  if (!attempt) throw new Error("Missing provider reference");
  const event = {
    kind: "payment",
    provider: "mock",
    providerEventId: id,
    providerReference: attempt.provider_reference,
    payloadHash: id,
    canonicalState: "FAILED",
    amountMinor: 1000,
    currency: "PHP",
    refundReference: null,
    observedAt: receivedAt,
  };
  const repository = extendPaymentRepository(env.DB);
  // Explicit retained verified receipt; actual scheduler creates its exhaustion case.
  await repository.insertInbox({
    ...event,
    eventType: "payment",
    normalizedObservationJson: JSON.stringify(event),
    rawPayload: "retained-test-receipt",
    signatureVerifiedAt: receivedAt,
    now: receivedAt,
  });
  expect(await redriveProviderInbox(env.DB, { now })).toMatchObject({ escalated: 1 });
  const inbox = await repository.findInboxEntry("mock", id);
  const record = await env.DB.prepare(
    "SELECT id,version FROM payment_reconciliation_case WHERE json_extract(details_json,'$.providerEventId')=?",
  )
    .bind(id)
    .first<{ id: string; version: number }>();
  const manager = await locationManager("global");
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='payments.manage'",
  )
    .bind(manager.id)
    .run();
  const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
    .bind(manager.id)
    .first<{ auth_user_id: string }>();
  if (!inbox || !record || !actor) throw new Error("Missing review fixture");
  return {
    inbox,
    receivedAt,
    paymentId: created.value.paymentIntentId,
    manager,
    command: {
      caseId: record.id,
      expectedVersion: record.version,
      reason: "Mapping and local processing reviewed",
      idempotencyKey: crypto.randomUUID(),
      actorAuthUserId: actor.auth_user_id,
      requestId: crypto.randomUUID(),
    },
  };
}
describe("reviewed provider event retry", () => {
  it("rolls back when the required retry audit is ignored", async () => {
    const f = await fixture();
    await env.DB.exec(
      "CREATE TRIGGER ignore_provider_retry_audit BEFORE INSERT ON audit_event WHEN NEW.action='PAYMENT.PROVIDER_EVENT_RETRY_REQUESTED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(await retryProviderEvent(env.DB, f.command)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(
        await env.DB.prepare(
          "SELECT recovery_started_at,processing_status FROM payment_provider_event_inbox WHERE id=?",
        )
          .bind(f.inbox.id)
          .first(),
      ).toEqual({ recovery_started_at: null, processing_status: "RECONCILIATION_REQUIRED" });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM idempotency_records WHERE scope='admin.payments.provider-event-retry' AND idempotency_key=?",
        )
          .bind(f.command.idempotencyKey)
          .first(),
      ).toEqual({ n: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_provider_retry_audit");
    }
    expect(await retryProviderEvent(env.DB, f.command)).toMatchObject({ ok: true });
  });
  it("expires a reviewed window at its exact age boundary without applying another event", async () => {
    const f = await fixture();
    expect(await retryProviderEvent(env.DB, f.command)).toMatchObject({ ok: true });
    const row = await env.DB.prepare(
      "SELECT recovery_started_at FROM payment_provider_event_inbox WHERE id=?",
    )
      .bind(f.inbox.id)
      .first<{ recovery_started_at: number }>();
    if (!row) throw new Error("Missing recovery window");
    expect(
      await redriveProviderInbox(env.DB, { now: row.recovery_started_at + 24 * 60 * 60 * 1000 }),
    ).toMatchObject({ escalated: 1, applied: 0 });
    expect(
      await env.DB.prepare(
        "SELECT attempts,received_at,last_error_code FROM payment_provider_event_inbox WHERE id=?",
      )
        .bind(f.inbox.id)
        .first(),
    ).toEqual({
      attempts: 0,
      received_at: f.receivedAt,
      last_error_code: "INBOX_REDRIVE_EXHAUSTED",
    });
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
        .bind(f.paymentId)
        .first(),
    ).toEqual({ status: "REQUIRES_ACTION" });
  });
  it("starts a bounded window, preserves receipt evidence and completes the same event without another provider create", async () => {
    const f = await fixture();
    expect(
      (await readProviderEventRecovery(env.DB, [f.command.caseId], true)).get(f.command.caseId),
    ).toMatchObject({ canRetry: true });
    const accepted = await retryProviderEvent(env.DB, f.command);
    expect(accepted).toMatchObject({
      ok: true,
      value: { state: "QUEUED", version: f.command.expectedVersion + 1 },
    });
    expect(await retryProviderEvent(env.DB, f.command)).toEqual(accepted);
    expect(await retryProviderEvent(env.DB, { ...f.command, reason: "changed" })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(
      await env.DB.prepare(
        "SELECT received_at,recovery_started_at,attempts FROM payment_provider_event_inbox WHERE id=?",
      )
        .bind(f.inbox.id)
        .first(),
    ).toMatchObject({
      received_at: f.receivedAt,
      recovery_started_at: expect.any(Number),
      attempts: 0,
    });
    expect(await redriveProviderInbox(env.DB)).toMatchObject({ applied: 1 });
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
        .bind(f.paymentId)
        .first(),
    ).toEqual({ status: "FAILED" });
    expect(
      await env.DB.prepare(
        "SELECT payment_intent_id,status,version FROM payment_reconciliation_case WHERE id=?",
      )
        .bind(f.command.caseId)
        .first(),
    ).toEqual({
      payment_intent_id: f.paymentId,
      status: "OPEN",
      version: f.command.expectedVersion + 2,
    });
    expect(await retryProviderEvent(env.DB, f.command)).toEqual(accepted);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.PROVIDER_EVENT_RETRY_REQUESTED'",
      )
        .bind(f.command.caseId)
        .first(),
    ).toEqual({ n: 1 });
  });
  it.each(["authority", "lease", "audit", "evidence"] as const)(
    "rejects transaction-time %s changes without a partial retry",
    async (kind) => {
      const f = await fixture();
      const db = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (kind === "authority")
                await target
                  .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                  .bind(f.manager.id)
                  .run();
              if (kind === "lease")
                await target
                  .prepare(
                    "UPDATE payment_provider_event_inbox SET lease_owner='another-worker',lease_expires_at=? WHERE id=?",
                  )
                  .bind(Date.now() + 60000, f.inbox.id)
                  .run();
              if (kind === "evidence")
                await target
                  .prepare(
                    "UPDATE payment_provider_event_inbox SET normalized_observation_json='{}' WHERE id=?",
                  )
                  .bind(f.inbox.id)
                  .run();
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
      expect(await retryProviderEvent(db, f.command)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(
        await env.DB.prepare("SELECT version FROM payment_reconciliation_case WHERE id=?")
          .bind(f.command.caseId)
          .first(),
      ).toEqual({ version: f.command.expectedVersion });
      expect(
        await env.DB.prepare(
          "SELECT processing_status,recovery_started_at FROM payment_provider_event_inbox WHERE id=?",
        )
          .bind(f.inbox.id)
          .first(),
      ).toEqual({ processing_status: "RECONCILIATION_REQUIRED", recovery_started_at: null });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM idempotency_records WHERE scope='admin.payments.provider-event-retry' AND idempotency_key=?",
        )
          .bind(f.command.idempotencyKey)
          .first(),
      ).toEqual({ n: 0 });
    },
  );
  it("admits one competing retry and rejects revoked replay", async () => {
    const f = await fixture();
    const results = await Promise.all([
      retryProviderEvent(env.DB, f.command),
      retryProviderEvent(env.DB, { ...f.command, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await env.DB.prepare("UPDATE staff_identity SET status='suspended' WHERE id=?")
      .bind(f.manager.id)
      .run();
    expect(await retryProviderEvent(env.DB, f.command)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
