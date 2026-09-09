import { locationManager } from "../../test-location-fixtures";
import { recheckStaffRefund } from "./recheck-staff-refund";
import { disabledEmailDeliveryPort } from "../../notifications/infrastructure/email-delivery-port";
import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reconcileRefunds } from "./reconcile-refunds";
import { createPayment } from "./create-payment";
import { ingestProviderEvent } from "./ingest-provider-event";
import { requestRefund, type RequestRefundCommand } from "./request-refund";
import {
  createMockPaymentProvider,
  mockSignatureFor,
  setMockRefundObservation,
} from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { extendPaymentRepositoryForRefunds } from "../infrastructure/d1/payment-repository";
const sharedMock = createMockPaymentProvider();
function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [sharedMock]);
}

let customerIdCounter = 0;
async function seedCustomer(): Promise<string> {
  const id = `cust-ref-${++customerIdCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

async function succeededIntent() {
  const created = await createPayment(env.DB, testRegistry(), {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_attempt",
    subjectId: `ca-${crypto.randomUUID()}`,
    customerId: await seedCustomer(),
    amountMinor: 20000,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/return",
    idempotencyKey: `ref-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("fixture failed");
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(created.value.paymentIntentId)
    .first<{ provider_reference: string }>();
  if (!attempt) throw new Error("Missing provider attempt");
  // Drive the intent to SUCCEEDED through verified events only.
  for (const vendorState of ["pending", "paid"]) {
    const rawBody = JSON.stringify({
      eventId: `evt-${crypto.randomUUID()}`,
      reference: attempt.provider_reference,
      vendorState,
      amountMinor: 20000,
      currency: "PHP",
    });
    await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      new Headers({
        "x-mock-signature": await mockSignatureFor(rawBody),
        "x-mock-timestamp": String(Date.now()),
      }),
      rawBody,
    );
  }
  return { intentId: created.value.paymentIntentId, reference: attempt.provider_reference };
}

function refundCommand(
  intentId: string,
  overrides: Partial<RequestRefundCommand> = {},
): RequestRefundCommand {
  return {
    paymentIntentId: intentId,
    amountMinor: 5000,
    reason: "customer-requested",
    idempotencyKey: `refund-${crypto.randomUUID()}`,
    actorId: "ops-1",
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

describe("bounded provider Refund lookup recovery", () => {
  async function uncertainRefund() {
    const paid = await succeededIntent();
    const command = refundCommand(paid.intentId);
    const originalSubmit = sharedMock.requestRefund.bind(sharedMock);
    let acceptedReference: string | null = null;
    const submit = vi.spyOn(sharedMock, "requestRefund").mockImplementationOnce(async (input) => {
      const accepted = await originalSubmit(input);
      if (!accepted.ok) throw new Error("Provider fixture rejected refund");
      acceptedReference = accepted.providerRefundReference;
      throw new Error("response lost after provider acceptance");
    });
    await requestRefund(env.DB, testRegistry(), command);
    submit.mockRestore();
    const refund = await extendPaymentRepositoryForRefunds(env.DB).findRefundByIdempotencyKey(
      command.idempotencyKey,
    );
    if (!refund) throw new Error("Refund fixture missing");
    const observed = {
      providerReference: paid.reference,
      providerRefundReference: acceptedReference ?? "missing-fixture-reference",
      idempotencyKey: command.idempotencyKey,
      canonicalState: "SUCCEEDED" as const,
      amountMinor: command.amountMinor,
      currency: "PHP",
      observedAt: Date.now(),
    };
    return { paid, command, refund, observed };
  }
  it("recovers an unknown submitted identity through the registered job without resubmission", async () => {
    const f = await uncertainRefund();
    setMockRefundObservation(sharedMock, f.command.idempotencyKey, {
      outcome: "FOUND",
      refund: f.observed,
    });
    const submit = vi.spyOn(sharedMock, "requestRefund");
    const { getJobsForCron } = await import("../../scheduling/job-registry");
    const job = getJobsForCron("* * * * *").find(
      (job) => job.name === "payments.refund-reconciliation",
    );
    expect(job).toBeDefined();
    if (!job) throw new Error("Missing registered recovery job");
    await job.run({
      database: env.DB,
      registry: testRegistry(),
      emailDelivery: disabledEmailDeliveryPort,
      now: Date.now() + 61_000,
    });
    const saved = await extendPaymentRepositoryForRefunds(env.DB).findRefundByIdempotencyKey(
      f.command.idempotencyKey,
    );
    expect(saved).toMatchObject({
      id: f.refund.id,
      status: "SUCCEEDED",
      providerRefundReference: f.observed.providerRefundReference,
    });
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
        .bind(f.paid.intentId)
        .first(),
    ).toEqual({ status: "PARTIALLY_REFUNDED" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='payments.refund.provider-observed'",
      )
        .bind(f.refund.id)
        .first(),
    ).toEqual({ n: 1 });
    const confirmation = await env.DB.prepare("SELECT succeeded_at FROM payment_refund WHERE id=?")
      .bind(f.refund.id)
      .first<{ succeeded_at: number | null }>();
    expect(confirmation?.succeeded_at).toEqual(expect.any(Number));
    await reconcileRefunds(env.DB, testRegistry(), Date.now() + 120_000);
    expect(
      await env.DB.prepare("SELECT succeeded_at FROM payment_refund WHERE id=?")
        .bind(f.refund.id)
        .first(),
    ).toEqual(confirmation);
    expect(submit).not.toHaveBeenCalled();
    submit.mockRestore();
  });
  it.each(["amount", "currency", "key", "reference"])(
    "keeps mismatched %s evidence unresolved and reserved",
    async (field) => {
      const f = await uncertainRefund();
      const observation = {
        ...f.observed,
        ...(field === "amount"
          ? { amountMinor: 1 }
          : field === "currency"
            ? { currency: "USD" }
            : field === "key"
              ? { idempotencyKey: "unrelated" }
              : { providerReference: "unrelated" }),
      };
      setMockRefundObservation(sharedMock, f.command.idempotencyKey, {
        outcome: "FOUND",
        refund: observation,
      });
      await reconcileRefunds(env.DB, testRegistry(), Date.now() + 61_000);
      expect(
        await env.DB.prepare(
          "SELECT status,provider_refund_reference,last_error_code FROM payment_refund WHERE id=?",
        )
          .bind(f.refund.id)
          .first(),
      ).toEqual({
        status: "ESCALATED",
        provider_refund_reference: null,
        last_error_code: "MISMATCH",
      });
    },
  );
  it("rolls back financial projection and binding when the required audit is ignored, then recovers", async () => {
    const f = await uncertainRefund();
    setMockRefundObservation(sharedMock, f.command.idempotencyKey, {
      outcome: "FOUND",
      refund: f.observed,
    });
    await env.DB.exec(
      "CREATE TRIGGER ignore_lookup_audit BEFORE INSERT ON audit_event WHEN NEW.action='payments.refund.provider-observed' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      await reconcileRefunds(env.DB, testRegistry(), Date.now() + 61_000);
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_lookup_audit");
    }
    expect(
      await env.DB.prepare("SELECT status,provider_refund_reference FROM payment_refund WHERE id=?")
        .bind(f.refund.id)
        .first(),
    ).toEqual({ status: "ESCALATED", provider_refund_reference: null });
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
        .bind(f.paid.intentId)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
    for (let batch = 0; batch < 3; batch++)
      await reconcileRefunds(env.DB, testRegistry(), Date.now() + 10 * 60_000);
    expect(
      await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
        .bind(f.refund.id)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
  });
  it("bounds missing lookup retries, shares a lease under races, and retains one recovery case", async () => {
    const f = await uncertainRefund();
    setMockRefundObservation(sharedMock, f.command.idempotencyKey, {
      outcome: "UNRESOLVED",
      reason: "NOT_FOUND",
    });
    const lookup = vi.spyOn(sharedMock, "lookupRefund");
    const start = Date.now() + 61_000;
    await Promise.all([
      reconcileRefunds(env.DB, testRegistry(), start),
      reconcileRefunds(env.DB, testRegistry(), start),
    ]);
    for (let i = 1; i < 15; i++)
      await reconcileRefunds(env.DB, testRegistry(), start + i * 2 * 60 * 60_000);
    expect(
      lookup.mock.calls.filter(
        ([input]) => input.refundProviderIdempotencyKey === f.command.idempotencyKey,
      ),
    ).toHaveLength(5);
    expect(
      await env.DB.prepare(
        "SELECT attempt_count,status,last_error_code FROM payment_refund WHERE id=?",
      )
        .bind(f.refund.id)
        .first(),
    ).toEqual({ attempt_count: 5, status: "ESCALATED", last_error_code: "NOT_FOUND" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM payment_reconciliation_case WHERE id=?")
        .bind(`refund-recovery:${f.refund.id}`)
        .first(),
    ).toEqual({ n: 1 });
    lookup.mockRestore();
  });
  it("repairs a crash after financial success without another lookup and bounds repeated projection failures", async () => {
    const f = await uncertainRefund();
    setMockRefundObservation(sharedMock, f.command.idempotencyKey, {
      outcome: "FOUND",
      refund: f.observed,
    });
    await env.DB.exec(
      "CREATE TRIGGER ignore_recovery_completion BEFORE INSERT ON audit_event WHEN NEW.action='payments.refund.recovery-completed' BEGIN SELECT RAISE(IGNORE); END",
    );
    const start = Date.now() + 61_000;
    try {
      for (let i = 0; i < 12; i++)
        await reconcileRefunds(env.DB, testRegistry(), start + i * 2 * 60 * 60_000);
      expect(
        await env.DB.prepare(
          "SELECT status,attempt_count,last_error_code FROM payment_refund WHERE id=?",
        )
          .bind(f.refund.id)
          .first(),
      ).toEqual({
        status: "SUCCEEDED",
        attempt_count: 5,
        last_error_code: "RECOVERY_APPLICATION_FAILED",
      });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_recovery_completion");
    }
    // Exhaustion is explicit review; it must not silently resume after a trigger disappears.
    const lookup = vi.spyOn(sharedMock, "lookupRefund");
    const before = await env.DB.prepare("SELECT version FROM payment_refund WHERE id=?")
      .bind(f.refund.id)
      .first();
    await reconcileRefunds(env.DB, testRegistry(), start + 48 * 60 * 60_000);
    expect(
      await env.DB.prepare("SELECT version FROM payment_refund WHERE id=?")
        .bind(f.refund.id)
        .first(),
    ).toEqual(before);
    expect(
      lookup.mock.calls.filter(
        ([input]) => input.refundProviderIdempotencyKey === f.command.idempotencyKey,
      ),
    ).toHaveLength(0);
    lookup.mockRestore();
  });
  async function recoveryDecision() {
    const f = await uncertainRefund();
    const manager = await locationManager("global");
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='refunds.manage'",
    )
      .bind(manager.id)
      .run();
    const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
      .bind(manager.id)
      .first<{ auth_user_id: string }>();
    if (!actor) throw new Error("Missing staff fixture");
    return {
      ...f,
      manager,
      decision: {
        refundId: f.refund.id,
        expectedVersion: f.refund.version,
        actorAuthUserId: actor.auth_user_id,
        reason: "Review unresolved provider response",
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      },
    };
  }
  it("queues an audited Global recheck and replays its original acceptance after recovery", async () => {
    const f = await recoveryDecision();
    const accepted = await recheckStaffRefund(env.DB, f.decision);
    expect(accepted).toMatchObject({ ok: true, value: { state: "QUEUED", refundId: f.refund.id } });
    setMockRefundObservation(sharedMock, f.command.idempotencyKey, {
      outcome: "FOUND",
      refund: f.observed,
    });
    for (let batch = 0; batch < 4; batch++)
      await reconcileRefunds(env.DB, testRegistry(), Date.now());
    expect(
      await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
        .bind(f.refund.id)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
    expect(await recheckStaffRefund(env.DB, f.decision)).toEqual(accepted);
    expect(await recheckStaffRefund(env.DB, { ...f.decision, reason: "changed" })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.REFUND_RECHECK_REQUESTED'",
      )
        .bind(f.refund.id)
        .first(),
    ).toEqual({ n: 1 });
  });
  it.each(["scope", "version", "lease", "audit"] as const)(
    "rejects changed %s without partial requeue or success receipt",
    async (kind) => {
      const f = await recoveryDecision();
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
                  .prepare("UPDATE payment_refund SET version=version+1 WHERE id=?")
                  .bind(f.refund.id)
                  .run();
              if (kind === "lease")
                await target
                  .prepare(
                    "UPDATE payment_refund SET processing_started_at=?,next_retry_at=? WHERE id=?",
                  )
                  .bind(Date.now(), Date.now() + 300000, f.refund.id)
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
      expect(await recheckStaffRefund(database, f.decision)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM idempotency_records WHERE scope='admin.payments.refund-recheck' AND idempotency_key=?",
        )
          .bind(f.decision.idempotencyKey)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.REFUND_RECHECK_REQUESTED'",
        )
          .bind(f.refund.id)
          .first(),
      ).toEqual({ n: 0 });
    },
  );
});
