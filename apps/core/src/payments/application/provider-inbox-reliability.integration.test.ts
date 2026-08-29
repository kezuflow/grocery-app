import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { VerifiedProviderEvent } from "../ports/payment-provider";
import { createPayment } from "./create-payment";
import { normalizedProviderObservation } from "./ingest-provider-event";
import { redriveProviderInbox } from "./redrive-provider-inbox";
import { createMockPaymentProvider } from "../infrastructure/providers/mock-payment-provider";
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
      available_at, lease_owner, lease_expires_at, updated_at
    ) VALUES (?, 'mock', ?, ?, 'payment', ?, ?, 'RETRY_REQUIRED', ?, ?, ?, ?, ?, ?)`,
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
      .first<{ processing_status: string; lease_owner: string | null; lease_expires_at: number | null }>();
    expect(inbox).toEqual({ processing_status: "APPLIED", lease_owner: null, lease_expires_at: null });
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
});
