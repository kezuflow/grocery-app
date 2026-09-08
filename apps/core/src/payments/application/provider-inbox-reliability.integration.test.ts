import { requestRefund } from "./request-refund";
import { extendPaymentRepository } from "../infrastructure/d1/payment-repository";
import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import type { VerifiedProviderEvent } from "../ports/payment-provider";
import { createPayment } from "./create-payment";
import { ingestProviderEvent, normalizedProviderObservation } from "./ingest-provider-event";
import { redriveProviderInbox } from "./redrive-provider-inbox";
import {
  createMockPaymentProvider,
  mockSignatureFor,
} from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";

function registry() {
  return new ProviderRegistry("test", [createMockPaymentProvider()]);
}

async function dueObservation(options: { attempts?: number; leaseExpiresAt?: number } = {}) {
  const suffix = crypto.randomUUID();
  const now = Date.now();
  const customerId = `inbox-customer-${suffix}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${suffix}`, now, now)
    .run();
  const created = await createPayment(env.DB, registry(), {
    purpose: "MEMBERSHIP_ENROLLMENT",
    subjectType: "subscription",
    subjectId: `subscription-${suffix}`,
    customerId,
    amountMinor: 29900,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/return",
    idempotencyKey: `inbox-${suffix}`,
    requestId: suffix,
  });
  if (!created.ok) throw new Error("payment fixture failed");
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(created.value.paymentIntentId)
    .first<{ provider_reference: string }>();
  const event: VerifiedProviderEvent = {
    provider: "mock",
    providerEventId: `event-${suffix}`,
    providerReference: attempt!.provider_reference,
    observedAt: now,
    canonicalState: "SUCCEEDED",
    amountMinor: 29900,
    currency: "PHP",
    payloadHash: `hash-${suffix}`,
    kind: "payment",
    refundReference: null,
  };
  const inboxId = `inbox-row-${suffix}`;
  await env.DB.prepare(
    `INSERT INTO payment_provider_event_inbox (
      id, provider, provider_event_id, provider_reference, event_type, payload_hash,
      normalized_observation_json, processing_status, attempts, received_at,
      available_at, lease_owner, lease_expires_at, updated_at, signature_verified_at
    ) VALUES (?, 'mock', ?, ?, 'payment', ?, ?, 'RETRY_REQUIRED', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      inboxId,
      event.providerEventId,
      event.providerReference,
      event.payloadHash,
      normalizedProviderObservation(event),
      options.attempts ?? 1,
      now,
      now - 1,
      options.leaseExpiresAt === undefined ? null : "stale-owner",
      options.leaseExpiresAt ?? null,
      now,
      now,
    )
    .run();
  const initialIntent = await env.DB.prepare("SELECT version FROM payment_intent WHERE id=?")
    .bind(created.value.paymentIntentId)
    .first<{ version: number }>();
  return {
    inboxId,
    intentId: created.value.paymentIntentId,
    initialVersion: initialIntent!.version,
    event,
    now,
  };
}

describe("provider inbox leases and redrive", () => {
  it("recovers a due observation without provider redelivery", async () => {
    const fixture = await dueObservation();
    const outcome = await redriveProviderInbox(env.DB, { now: fixture.now + 1 });
    expect(outcome).toMatchObject({ claimed: 1, applied: 1 });
    const state = await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(fixture.intentId)
      .first<{ status: string }>();
    expect(state?.status).toBe("SUCCEEDED");
    const inbox = await env.DB.prepare(
      "SELECT processing_status, lease_owner, lease_expires_at FROM payment_provider_event_inbox WHERE id=?",
    )
      .bind(fixture.inboxId)
      .first<{
        processing_status: string;
        lease_owner: string | null;
        lease_expires_at: number | null;
      }>();
    expect(inbox).toEqual({
      processing_status: "APPLIED",
      lease_owner: null,
      lease_expires_at: null,
    });
  });

  it("reclaims an expired lease", async () => {
    const fixture = await dueObservation({ leaseExpiresAt: Date.now() - 1 });
    const outcome = await redriveProviderInbox(env.DB, { now: fixture.now + 1 });
    expect(outcome).toMatchObject({ claimed: 1, applied: 1 });
  });

  it("allows only one competing worker to apply an observation", async () => {
    const fixture = await dueObservation();
    const outcomes = await Promise.all([
      redriveProviderInbox(env.DB, { now: fixture.now + 1 }),
      redriveProviderInbox(env.DB, { now: fixture.now + 1 }),
    ]);
    expect(outcomes.reduce((sum, item) => sum + item.applied, 0)).toBe(1);
    const intent = await env.DB.prepare("SELECT status, version FROM payment_intent WHERE id=?")
      .bind(fixture.intentId)
      .first<{ status: string; version: number }>();
    expect(intent).toMatchObject({
      status: "SUCCEEDED",
      // REQUIRES_ACTION -> PROCESSING -> SUCCEEDED is one owner walking two
      // legal state-machine hops, not two workers applying the observation.
      version: fixture.initialVersion + 2,
    });
  });

  it("escalates exhausted observations exactly once", async () => {
    const fixture = await dueObservation({ attempts: 10 });
    const first = await redriveProviderInbox(env.DB, { now: fixture.now + 1 });
    const second = await redriveProviderInbox(env.DB, { now: fixture.now + 2 });
    expect(first.escalated).toBe(1);
    expect(second.inspected).toBe(0);
    const inbox = await env.DB.prepare(
      "SELECT processing_status FROM payment_provider_event_inbox WHERE id=?",
    )
      .bind(fixture.inboxId)
      .first<{ processing_status: string }>();
    expect(inbox?.processing_status).toBe("RECONCILIATION_REQUIRED");
  });
  it.each(["paid", "failed"])(
    "recovers an early verified %s event after creation persists its mapping",
    async (vendorState) => {
      const provider = createMockPaymentProvider(),
        providers = new ProviderRegistry("test", [provider]);
      const suffix = crypto.randomUUID(),
        now = Date.now();
      await env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      )
        .bind(suffix, suffix, now, now)
        .run();
      const create = provider.createPayment.bind(provider);
      const eventId = `early-${suffix}`;
      vi.spyOn(provider, "createPayment").mockImplementation(async (input) => {
        const accepted = await create(input);
        if (!accepted.ok) return accepted;
        const body = JSON.stringify({
          eventId,
          reference: accepted.providerReference,
          vendorState,
          amountMinor: input.amountMinor,
          currency: input.currency,
          kind: "payment",
        });
        expect(
          await ingestProviderEvent(
            env.DB,
            providers,
            "mock",
            new Headers({
              "x-mock-signature": await mockSignatureFor(body),
              "x-mock-timestamp": String(Date.now()),
            }),
            body,
          ),
        ).toMatchObject({ ok: true, value: { processingStatus: "RECONCILIATION_REQUIRED" } });
        return accepted;
      });
      const created = await createPayment(env.DB, providers, {
        purpose: "GROCERY_CHECKOUT",
        subjectType: "checkout_attempt",
        subjectId: suffix,
        customerId: suffix,
        amountMinor: 15000,
        currency: "PHP",
        providerCode: "mock",
        returnUrl: "https://app.example/return",
        idempotencyKey: suffix,
        requestId: suffix,
      });
      if (!created.ok) throw new Error("Creation fixture failed");
      const before = await env.DB.prepare(
        "SELECT payment_intent_id,status,version FROM payment_reconciliation_case WHERE category='UNMAPPED_PROVIDER_REFERENCE' AND json_extract(details_json,'$.providerReference')=(SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?)",
      )
        .bind(created.value.paymentIntentId)
        .first();
      expect(before).toEqual({ payment_intent_id: null, status: "OPEN", version: 1 });
      if (vendorState === "paid")
        await env.DB.exec(
          "CREATE TRIGGER ignore_case_link_audit BEFORE INSERT ON audit_event WHEN NEW.action='PAYMENT.RECONCILIATION_LINKED' BEGIN SELECT RAISE(IGNORE); END",
        );
      try {
        await redriveProviderInbox(env.DB, { now: Date.now() + 2000 });
      } finally {
        if (vendorState === "paid") await env.DB.exec("DROP TRIGGER ignore_case_link_audit");
      }
      if (vendorState === "paid") {
        const retry = await env.DB.prepare(
          "SELECT processing_status,available_at FROM payment_provider_event_inbox WHERE provider_event_id=?",
        )
          .bind(eventId)
          .first<{ processing_status: string; available_at: number }>();
        expect(retry?.processing_status).toBe("RETRY_REQUIRED");
        expect(
          await env.DB.prepare(
            "SELECT payment_intent_id FROM payment_reconciliation_case WHERE category='UNMAPPED_PROVIDER_REFERENCE' AND json_extract(details_json,'$.providerReference')=(SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?)",
          )
            .bind(created.value.paymentIntentId)
            .first(),
        ).toEqual({ payment_intent_id: null });
        if (!retry) throw new Error("Missing saved retry");
        await redriveProviderInbox(env.DB, { now: retry.available_at });
      }
      expect(
        await env.DB.prepare(
          "SELECT processing_status FROM payment_provider_event_inbox WHERE provider_event_id=?",
        )
          .bind(eventId)
          .first(),
      ).toEqual({ processing_status: "APPLIED" });
      expect(
        await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
          .bind(created.value.paymentIntentId)
          .first(),
      ).toEqual({ status: vendorState === "paid" ? "SUCCEEDED" : "FAILED" });
      expect(
        await env.DB.prepare(
          "SELECT status,version FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='UNMAPPED_PROVIDER_REFERENCE'",
        )
          .bind(created.value.paymentIntentId)
          .first(),
      ).toEqual({ status: "OPEN", version: 2 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM audit_event WHERE action='PAYMENT.RECONCILIATION_LINKED' AND aggregate_id IN (SELECT id FROM payment_reconciliation_case WHERE payment_intent_id=?)",
        )
          .bind(created.value.paymentIntentId)
          .first(),
      ).toEqual({ n: 1 });
    },
  );
  it("persists an attempt before work and exhausts an abandoned final lease without applying it", async () => {
    const f = await dueObservation({ attempts: 9 }),
      repository = extendPaymentRepository(env.DB);
    expect(
      await repository.claimInbox({
        id: f.inboxId,
        leaseOwner: "interrupted-worker",
        now: f.now,
        leaseMs: 1000,
        expectedAttempts: 9,
      }),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT attempts FROM payment_provider_event_inbox WHERE id=?")
        .bind(f.inboxId)
        .first(),
    ).toEqual({ attempts: 10 });
    expect(
      await repository.claimInbox({
        id: f.inboxId,
        leaseOwner: "provider-redelivery",
        now: f.now + 1001,
        leaseMs: 1000,
        expectedAttempts: 10,
      }),
    ).toBe(0);
    await redriveProviderInbox(env.DB, { now: f.now + 1001 });
    expect(
      await env.DB.prepare(
        "SELECT processing_status,last_error_code,attempts FROM payment_provider_event_inbox WHERE id=?",
      )
        .bind(f.inboxId)
        .first(),
    ).toEqual({
      processing_status: "RECONCILIATION_REQUIRED",
      last_error_code: "INBOX_REDRIVE_EXHAUSTED",
      attempts: 10,
    });
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?").bind(f.intentId).first(),
    ).toEqual({ status: "REQUIRES_ACTION" });
  });
  it("bounds repeated application failures and continues other due observations", async () => {
    const bad = await dueObservation({ attempts: 0 }),
      good = await dueObservation({ attempts: 0 });
    await env.DB.exec(
      `CREATE TRIGGER ignore_inbox_payment BEFORE UPDATE ON payment_intent WHEN OLD.id='${bad.intentId}' BEGIN SELECT RAISE(ABORT,'TEST_APPLICATION_FAILURE'); END`,
    );
    let now = Math.max(bad.now, good.now) + 1;
    try {
      for (let attempt = 1; attempt <= 10; attempt++) {
        await redriveProviderInbox(env.DB, { now });
        const row = await env.DB.prepare(
          "SELECT attempts,available_at,last_error_code FROM payment_provider_event_inbox WHERE id=?",
        )
          .bind(bad.inboxId)
          .first<{ attempts: number; available_at: number; last_error_code: string }>();
        expect(row).toMatchObject({
          attempts: attempt,
          last_error_code: "INBOX_APPLICATION_FAILED",
        });
        if (!row) throw new Error("Missing bounded retry");
        now = row.available_at;
      }
      await redriveProviderInbox(env.DB, { now });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_inbox_payment");
    }
    expect(
      await env.DB.prepare("SELECT processing_status FROM payment_provider_event_inbox WHERE id=?")
        .bind(good.inboxId)
        .first(),
    ).toEqual({ processing_status: "APPLIED" });
    expect(
      await env.DB.prepare(
        "SELECT last_error_code,attempts FROM payment_provider_event_inbox WHERE id=?",
      )
        .bind(bad.inboxId)
        .first(),
    ).toEqual({ last_error_code: "INBOX_REDRIVE_EXHAUSTED", attempts: 10 });
    const changed = await extendPaymentRepository(env.DB).setInboxStatus({
      id: good.inboxId,
      processingStatus: "RETRY_REQUIRED",
      errorCode: "LATE_FAILURE",
      now,
    });
    expect(changed).toBe(0);
    expect(
      await env.DB.prepare("SELECT processing_status FROM payment_provider_event_inbox WHERE id=?")
        .bind(good.inboxId)
        .first(),
    ).toEqual({ processing_status: "APPLIED" });
  });
  it.each(["provider", "providerEventId", "amountMinor", "settlement"])(
    "rejects corrupted normalized %s before financial application",
    async (field) => {
      const f = await dueObservation();
      const value: unknown =
        field === "amountMinor"
          ? 0
          : field === "settlement"
            ? {
                grossMinor: 10,
                processingCostMinor: 0,
                withholdingMinor: 0,
                adjustmentMinor: 0,
                netMinor: 9,
                currency: "PHP",
                observedAt: f.now,
              }
            : "different-identity";
      await env.DB.prepare(
        "UPDATE payment_provider_event_inbox SET normalized_observation_json=? WHERE id=?",
      )
        .bind(JSON.stringify({ ...f.event, [field]: value }), f.inboxId)
        .run();
      await redriveProviderInbox(env.DB, { now: f.now + 1 });
      expect(
        await env.DB.prepare(
          "SELECT processing_status,last_error_code FROM payment_provider_event_inbox WHERE id=?",
        )
          .bind(f.inboxId)
          .first(),
      ).toEqual({
        processing_status: "REJECTED",
        last_error_code: "NORMALIZED_OBSERVATION_INVALID",
      });
      expect(
        await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
          .bind(f.intentId)
          .first(),
      ).toEqual({ status: "REQUIRES_ACTION" });
    },
  );
  it("recovers an early verified refund after its provider reference is bound", async () => {
    const f = await dueObservation();
    await redriveProviderInbox(env.DB, { now: f.now + 1 });
    const provider = createMockPaymentProvider(),
      providers = new ProviderRegistry("test", [provider]);
    const submit = provider.requestRefund.bind(provider),
      eventId = crypto.randomUUID();
    vi.spyOn(provider, "requestRefund").mockImplementation(async (input) => {
      const accepted = await submit(input);
      if (!accepted.ok) return accepted;
      const body = JSON.stringify({
        eventId,
        reference: f.event.providerReference,
        refundReference: accepted.providerRefundReference,
        kind: "refund",
        vendorState: "paid",
        amountMinor: input.amountMinor,
        currency: "PHP",
      });
      expect(
        await ingestProviderEvent(
          env.DB,
          providers,
          "mock",
          new Headers({
            "x-mock-signature": await mockSignatureFor(body),
            "x-mock-timestamp": String(Date.now()),
          }),
          body,
        ),
      ).toMatchObject({ ok: true, value: { processingStatus: "RECONCILIATION_REQUIRED" } });
      return accepted;
    });
    const refund = await requestRefund(env.DB, providers, {
      paymentIntentId: f.intentId,
      amountMinor: 100,
      reason: "Verified quality issue",
      idempotencyKey: crypto.randomUUID(),
      actorId: "system:test",
      requestId: crypto.randomUUID(),
    });
    if (!refund.ok) throw new Error("Refund fixture failed");
    await redriveProviderInbox(env.DB, { now: Date.now() + 2000 });
    expect(
      await env.DB.prepare(
        "SELECT processing_status FROM payment_provider_event_inbox WHERE provider_event_id=?",
      )
        .bind(eventId)
        .first(),
    ).toEqual({ processing_status: "APPLIED" });
    expect(
      await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
        .bind(refund.value.refundId)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?").bind(f.intentId).first(),
    ).toEqual({ status: "PARTIALLY_REFUNDED" });
    expect(
      await env.DB.prepare(
        "SELECT status,version FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='UNMAPPED_PROVIDER_REFERENCE'",
      )
        .bind(f.intentId)
        .first(),
    ).toEqual({ status: "OPEN", version: 2 });
  });
  it("does not treat a normalized legacy payload as verification evidence", async () => {
    const f = await dueObservation();
    await env.DB.prepare(
      "UPDATE payment_provider_event_inbox SET signature_verified_at=NULL WHERE id=?",
    )
      .bind(f.inboxId)
      .run();
    await redriveProviderInbox(env.DB, { now: f.now + 1 });
    expect(
      await env.DB.prepare("SELECT processing_status FROM payment_provider_event_inbox WHERE id=?")
        .bind(f.inboxId)
        .first(),
    ).toEqual({ processing_status: "REJECTED" });
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?").bind(f.intentId).first(),
    ).toEqual({ status: "REQUIRES_ACTION" });
  });
});
