import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { startPromotionalTrial } from "./start-promotional-trial";
import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  type CancelSubscriptionCommand,
  type PauseSubscriptionCommand,
  type ResumeSubscriptionCommand,
} from "./change-subscription";

let customerCounter = 0;
async function trialingSubscription(): Promise<{ customerId: string; subscriptionId: string }> {
  const customerId = `cust-life-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, Date.now(), Date.now())
    .run();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'mock', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
  )
    .bind(
      `authz-${customerId}`,
      customerId,
      `mock_auth_${customerId}`,
      `mock_method_${customerId}`,
      now,
      now,
      now,
    )
    .run();
  const result = await startPromotionalTrial(env.DB, {
    customerId,
    idempotencyKey: `trial-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("fixture failed");
  return { customerId, subscriptionId: result.value.subscriptionId };
}

function pauseCommand(subscriptionId: string): PauseSubscriptionCommand {
  return {
    subscriptionId,
    idempotencyKey: `pause-${crypto.randomUUID()}`,
    expectedVersion: 1,
    requestId: crypto.randomUUID(),
  };
}
function resumeCommand(subscriptionId: string): ResumeSubscriptionCommand {
  return {
    subscriptionId,
    idempotencyKey: `resume-${crypto.randomUUID()}`,
    expectedVersion: 1,
    requestId: crypto.randomUUID(),
  };
}
function cancelCommand(
  subscriptionId: string,
  timing: "IMMEDIATE" | "PERIOD_END",
): CancelSubscriptionCommand {
  return {
    subscriptionId,
    timing,
    idempotencyKey: `cancel-${crypto.randomUUID()}`,
    expectedVersion: 1,
    requestId: crypto.randomUUID(),
  };
}

describe("versioned subscription lifecycle", () => {
  it("pauses and resumes an active subscription", async () => {
    const { customerId, subscriptionId } = await trialingSubscription();
    // Paid activation moves TRIALING to ACTIVE before lifecycle changes.
    await env.DB.prepare("UPDATE subscription SET status='ACTIVE', version=version+1 WHERE id=?")
      .bind(subscriptionId)
      .run();
    const current = await env.DB.prepare("SELECT version FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ version: number }>();
    void customerId;
    const paused = await pauseSubscription(env.DB, {
      ...pauseCommand(subscriptionId),
      expectedVersion: current!.version,
    });
    expect(paused).toMatchObject({ ok: true, value: { state: "PAUSED" } });
    // Canonical resume returns the subscription to ACTIVE and clears intent.
    const resume = resumeCommand(subscriptionId);
    const resumeWithVersion: ResumeSubscriptionCommand = {
      ...resume,
      expectedVersion: paused.ok ? paused.value.version : 1,
    };
    const resumedFirst = await resumeSubscription(env.DB, resumeWithVersion);
    expect(resumedFirst).toMatchObject({
      ok: true,
      value: { state: "ACTIVE", cancelAtPeriodEnd: false },
    });
    const replayedResume = await resumeSubscription(env.DB, resumeWithVersion);
    expect(replayedResume).toEqual(resumedFirst);
  });

  it("keeps period-end intent non-terminal until the effective instant", async () => {
    const { subscriptionId } = await trialingSubscription();
    const requested = await cancelSubscription(env.DB, cancelCommand(subscriptionId, "PERIOD_END"));
    expect(requested).toMatchObject({
      ok: true,
      value: { state: "TRIALING", cancelAtPeriodEnd: true, version: 2 },
    });

    // Applying one millisecond before the trial end must fail.
    const row = await env.DB.prepare("SELECT trial_ends_at FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ trial_ends_at: number }>();
    const early = nowPlus(row!.trial_ends_at - 1);
    void early;

    const atInstant = await applyCancelForTest(subscriptionId, row!.trial_ends_at);
    expect(atInstant.applied).toBe(true);
    const finalRow = await env.DB.prepare("SELECT status, ended_at FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string; ended_at: number | null }>();
    expect(finalRow?.status).toBe("CANCELED");
    expect(finalRow?.ended_at).toBe(row!.trial_ends_at);
  });

  it("replays the same immediate cancellation result", async () => {
    const { subscriptionId } = await trialingSubscription();
    const command = cancelCommand(subscriptionId, "IMMEDIATE");
    const first = await cancelSubscription(env.DB, command);
    expect(first).toMatchObject({ ok: true, value: { state: "CANCELED" } });
    const replay = await cancelSubscription(env.DB, command);
    expect(replay).toEqual(first);
    // Terminal: no further transitions succeed.
    const after = await pauseSubscription(env.DB, {
      ...pauseCommand(subscriptionId),
      expectedVersion: 99,
    });
    expect(after).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  });

  it("enforces optimistic versions on lifecycle commands", async () => {
    const { subscriptionId } = await trialingSubscription();
    const stale = await cancelSubscription(env.DB, {
      ...cancelCommand(subscriptionId, "IMMEDIATE"),
      expectedVersion: 0,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    const stillThere = await env.DB.prepare("SELECT status FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string }>();
    expect(stillThere?.status).toBe("TRIALING");
  });

  it("rejects idempotency-key reuse with a different expected version", async () => {
    const { subscriptionId } = await trialingSubscription();
    const command = cancelCommand(subscriptionId, "IMMEDIATE");
    const first = await cancelSubscription(env.DB, command);
    expect(first.ok).toBe(true);
    const reused = await cancelSubscription(env.DB, { ...command, expectedVersion: 99 });
    expect(reused).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("fails period-end cancellation closed for past-due membership", async () => {
    const { subscriptionId } = await trialingSubscription();
    await env.DB.prepare("UPDATE subscription SET status='PAST_DUE' WHERE id=?")
      .bind(subscriptionId)
      .run();
    const result = await cancelSubscription(env.DB, cancelCommand(subscriptionId, "PERIOD_END"));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
  });
});

function nowPlus(_ms: number): number {
  return Date.now() + _ms;
}

async function applyCancelForTest(subscriptionId: string, effectiveAt: number) {
  const { applyScheduledCancellations } = await import("./apply-scheduled-cancellations");
  // Seed the scheduled instant so the batched selector sees this record as due.
  await env.DB.prepare("UPDATE subscription SET scheduled_cancellation_at=? WHERE id=?")
    .bind(effectiveAt, subscriptionId)
    .run();
  const outcomes = await applyScheduledCancellations(env.DB, effectiveAt, 50);
  const mine = outcomes.find((outcome) => outcome.subscriptionId === subscriptionId);
  return mine ?? { applied: false };
}
