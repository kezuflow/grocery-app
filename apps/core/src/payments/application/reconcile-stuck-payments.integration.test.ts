import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createPayment } from "./create-payment";
import { reconcileStuckPayments } from "./reconcile-stuck-payments";
import { recheckStaffPayment } from "./recheck-staff-payment";
import {
  createMockPaymentProvider,
  setMockObservedState,
} from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { locationManager } from "../../test-location-fixtures";

async function fixture() {
  const provider = createMockPaymentProvider(),
    registry = new ProviderRegistry("test", [provider]);
  const id = crypto.randomUUID(),
    now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
  )
    .bind(id, id, now, now)
    .run();
  const created = await createPayment(env.DB, registry, {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_attempt",
    subjectId: crypto.randomUUID(),
    customerId: id,
    amountMinor: 15000,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/return",
    idempotencyKey: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
  });
  if (!created.ok) throw new Error("Payment fixture failed");
  const paymentIntentId = created.value.paymentIntentId;
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(paymentIntentId)
    .first<{ provider_reference: string }>();
  if (!attempt) throw new Error("Missing attempt");
  return {
    provider,
    registry,
    paymentIntentId,
    reference: attempt.provider_reference,
    now: now + 20 * 60000,
  };
}
async function state(id: string) {
  return env.DB.prepare(
    "SELECT status,attempts,version,available_at,lease_token FROM payment_lookup_recovery WHERE payment_intent_id=?",
  )
    .bind(id)
    .first<{
      status: string;
      attempts: number;
      version: number;
      available_at: number;
      lease_token: string | null;
    }>();
}
async function manager(
  f: Awaited<ReturnType<typeof fixture>>,
  scope: "global" | "location" = "global",
) {
  const staff = await locationManager(scope);
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='payments.manage'",
  )
    .bind(staff.id)
    .run();
  const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
    .bind(staff.id)
    .first<{ auth_user_id: string }>();
  const payment = await env.DB.prepare("SELECT version FROM payment_intent WHERE id=?")
    .bind(f.paymentIntentId)
    .first<{ version: number }>();
  if (!actor || !payment) throw new Error("Missing authorization fixture");
  return {
    paymentIntentId: f.paymentIntentId,
    expectedVersion: payment.version,
    expectedRecoveryVersion: 0,
    reason: "Verify provider after outage",
    idempotencyKey: crypto.randomUUID(),
    actorAuthUserId: actor.auth_user_id,
    requestId: crypto.randomUUID(),
  };
}
describe("bounded payment lookup recovery", () => {
  it("claims concurrent sweeps once and applies a provider-confirmed terminal observation", async () => {
    const f = await fixture();
    setMockObservedState(f.provider, f.reference, "FAILED");
    const lookup = vi.spyOn(f.provider, "getPayment");
    await Promise.all([
      reconcileStuckPayments(env.DB, f.registry, f.now),
      reconcileStuckPayments(env.DB, f.registry, f.now),
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await state(f.paymentIntentId)).toMatchObject({
      status: "COMPLETED",
      attempts: 1,
      lease_token: null,
    });
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
        .bind(f.paymentIntentId)
        .first(),
    ).toEqual({ status: "FAILED" });
  });
  it("backs off, exhausts five lookups, exposes one audited case and permits an authorized new bounded check", async () => {
    const f = await fixture(),
      command = await manager(f);
    const lookup = vi
      .spyOn(f.provider, "getPayment")
      .mockRejectedValue(new Error("private provider response"));
    let now = f.now;
    for (let n = 1; n <= 5; n++) {
      await reconcileStuckPayments(env.DB, f.registry, now);
      const row = await state(f.paymentIntentId);
      expect(row?.attempts).toBe(n);
      await reconcileStuckPayments(env.DB, f.registry, now);
      expect(lookup).toHaveBeenCalledTimes(n);
      now = row?.available_at ?? now;
    }
    const exhausted = await state(f.paymentIntentId);
    expect(exhausted?.status).toBe("EXHAUSTED");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.LOOKUP_EXHAUSTED'",
      )
        .bind(f.paymentIntentId)
        .first(),
    ).toEqual({ n: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM payment_reconciliation_case WHERE id=? AND status='OPEN'",
      )
        .bind(`payment-lookup:${f.paymentIntentId}`)
        .first(),
    ).toEqual({ n: 1 });
    const retry = { ...command, expectedRecoveryVersion: exhausted?.version ?? 0 };
    const accepted = await recheckStaffPayment(env.DB, retry);
    expect(accepted.ok).toBe(true);
    lookup.mockRestore();
    setMockObservedState(f.provider, f.reference, "FAILED");
    await reconcileStuckPayments(env.DB, f.registry, now);
    expect(await state(f.paymentIntentId)).toMatchObject({ status: "COMPLETED", attempts: 1 });
    expect(await recheckStaffPayment(env.DB, retry)).toEqual(accepted);
    expect(
      await recheckStaffPayment(env.DB, { ...retry, reason: "Different reason" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it("recovers a final interrupted lease without issuing a sixth lookup", async () => {
    const f = await fixture();
    await env.DB.prepare(
      "INSERT INTO payment_lookup_recovery(payment_intent_id,status,attempts,available_at,lease_token,created_at,updated_at) VALUES (?,'PENDING',5,?,'interrupted',?,?)",
    )
      .bind(f.paymentIntentId, f.now, f.now, f.now)
      .run();
    const lookup = vi.spyOn(f.provider, "getPayment");
    await reconcileStuckPayments(env.DB, f.registry, f.now);
    expect(lookup).not.toHaveBeenCalled();
    expect(await state(f.paymentIntentId)).toMatchObject({ status: "EXHAUSTED", attempts: 5 });
  });
  it("guards scope, stale payment/recovery versions, active leases, audit failure and competing new claims", async () => {
    const f = await fixture();
    expect(await recheckStaffPayment(env.DB, await manager(f, "location"))).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    const command = await manager(f);
    expect(await recheckStaffPayment(env.DB, { ...command, expectedVersion: 999 })).toMatchObject({
      ok: false,
    });
    expect(await state(f.paymentIntentId)).toBeNull();
    await env.DB.exec(
      "CREATE TRIGGER ignore_lookup_audit BEFORE INSERT ON audit_event WHEN NEW.action='PAYMENT.LOOKUP_RECHECK_REQUESTED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(await recheckStaffPayment(env.DB, command)).toMatchObject({ ok: false });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_lookup_audit");
    }
    expect(await state(f.paymentIntentId)).toBeNull();
    const results = await Promise.all([
      recheckStaffPayment(env.DB, command),
      recheckStaffPayment(env.DB, { ...command, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await env.DB.prepare(
      "UPDATE payment_lookup_recovery SET lease_token='busy',available_at=? WHERE payment_intent_id=?",
    )
      .bind(Date.now() + 60000, f.paymentIntentId)
      .run();
    expect(
      await recheckStaffPayment(env.DB, {
        ...command,
        expectedRecoveryVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false });
  });
  it("does not let the oldest unresolved batch starve a later payment", async () => {
    const f = await fixture();
    for (let i = 0; i < 11; i++) {
      await env.DB.prepare(
        "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_attempt','missing','legacy-customer',100,'PHP','PROCESSING',?,?,?)",
      )
        .bind(`older-${i}`, `older-${i}`, 1, 1)
        .run();
    }
    setMockObservedState(f.provider, f.reference, "FAILED");
    await reconcileStuckPayments(env.DB, f.registry, f.now);
    expect(await state(f.paymentIntentId)).toBeNull();
    await reconcileStuckPayments(env.DB, f.registry, f.now);
    expect(await state(f.paymentIntentId)).toMatchObject({ status: "COMPLETED", attempts: 1 });
  });
  it("keeps final-attempt recovery after a lost required exhaustion audit without another provider call", async () => {
    const f = await fixture();
    await env.DB.prepare(
      "INSERT INTO payment_lookup_recovery(payment_intent_id,status,attempts,available_at,created_at,updated_at) VALUES (?,'PENDING',4,?,?,?)",
    )
      .bind(f.paymentIntentId, f.now, f.now, f.now)
      .run();
    const lookup = vi.spyOn(f.provider, "getPayment").mockRejectedValue(new Error("unavailable"));
    await env.DB.exec(
      "CREATE TRIGGER ignore_lookup_exhaustion BEFORE INSERT ON audit_event WHEN NEW.action='PAYMENT.LOOKUP_EXHAUSTED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      await expect(reconcileStuckPayments(env.DB, f.registry, f.now)).rejects.toThrow();
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_lookup_exhaustion");
    }
    expect(await state(f.paymentIntentId)).toMatchObject({ status: "PENDING", attempts: 5 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM payment_reconciliation_case WHERE id=?")
        .bind(`payment-lookup:${f.paymentIntentId}`)
        .first(),
    ).toEqual({ n: 0 });
    // Earlier fixtures also have due recovery; drain bounded batches at the same instant.
    for (let batch = 0; batch < 3; batch++)
      await reconcileStuckPayments(env.DB, f.registry, f.now + 5 * 60000);
    expect(lookup.mock.calls.filter(([reference]) => reference === f.reference)).toHaveLength(1);
    expect(await state(f.paymentIntentId)).toMatchObject({ status: "EXHAUSTED", attempts: 5 });
  });
  it("revalidates current authority in the admission batch and rejects revoked replay", async () => {
    const f = await fixture(),
      command = await manager(f);
    const database = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare("UPDATE staff_identity SET status='suspended' WHERE auth_user_id=?")
              .bind(command.actorAuthUserId)
              .run();
            return target.batch(statements);
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await recheckStaffPayment(database, command)).toMatchObject({ ok: false });
    expect(await state(f.paymentIntentId)).toBeNull();
    await env.DB.prepare("UPDATE staff_identity SET status='active' WHERE auth_user_id=?")
      .bind(command.actorAuthUserId)
      .run();
    expect(await recheckStaffPayment(env.DB, command)).toMatchObject({ ok: true });
    await env.DB.prepare("UPDATE staff_identity SET status='suspended' WHERE auth_user_id=?")
      .bind(command.actorAuthUserId)
      .run();
    expect(await recheckStaffPayment(env.DB, command)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
