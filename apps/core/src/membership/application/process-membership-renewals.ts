import { createPayment } from "../../payments/application/create-payment";
import type { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
import { addCalendarDays } from "../domain/billing-calendar";
import { createMembershipRepository } from "../infrastructure/d1/membership-repository";

/**
 * Application-owned renewal machinery (single attempt per period; retries stay
 * with the provider per PROVIDER_DECISIONS.md). Three guarded steps driven by
 * the scheduler: initiate due renewal charges, apply provider-confirmed
 * failure outcomes, and expire exhausted grace windows.
 */

const RENEWAL_RETURN_URL = "urn:freshmarkets:membership:renewal";

type DueRenewalRow = {
  id: string;
  customer_id: string;
  status: string;
  trial_ends_at: number | null;
  current_period_ends_at: number | null;
  payment_authorization_id: string | null;
  provider: string | null;
  fee_minor: number;
  currency: string;
};

function dueBoundary(row: DueRenewalRow): number | null {
  return row.status === "TRIALING" ? row.trial_ends_at : row.current_period_ends_at;
}

export type RenewalStepOutcome = {
  initiated: number;
  initiationFailures: number;
  initiationSkipped: boolean;
  failureOutcomesApplied: number;
  graceExpired: number;
};

export async function processMembershipRenewals(
  database: D1Database,
  registry: ProviderRegistry,
  now: number,
  options: { initiationEnabled: boolean },
  limit = 25,
): Promise<RenewalStepOutcome> {
  const initiation = options.initiationEnabled
    ? await initiateDueMembershipRenewals(database, registry, now, limit)
    : { initiated: 0, initiationFailures: 0 };
  const failureOutcomesApplied = await applyConfirmedRenewalFailures(database, now, limit);
  const graceExpired = await expireExhaustedGrace(database, now, limit);
  return {
    ...initiation,
    initiationSkipped: !options.initiationEnabled,
    failureOutcomesApplied,
    graceExpired,
  };
}

async function initiateDueMembershipRenewals(
  database: D1Database,
  registry: ProviderRegistry,
  now: number,
  limit: number,
): Promise<{ initiated: number; initiationFailures: number }> {
  const rows = await database
    .prepare(
      `SELECT s.id, s.customer_id, s.status, s.trial_ends_at, s.current_period_ends_at, s.payment_authorization_id, a.provider, o.fee_minor, o.currency
       FROM subscription s
       JOIN subscription_offer o ON o.id = s.offer_id
       LEFT JOIN payment_authorization a ON a.id = s.payment_authorization_id
       WHERE ((s.status='TRIALING' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at <= ?)
           OR (s.status='ACTIVE' AND s.current_period_ends_at IS NOT NULL AND s.current_period_ends_at <= ?))
         AND (s.renewal_initiated_through IS NULL OR s.renewal_initiated_through <
              CASE WHEN s.status='TRIALING' THEN s.trial_ends_at ELSE s.current_period_ends_at END)
       LIMIT ?`,
    )
    .bind(now, now, limit)
    .all<DueRenewalRow>();

  let initiated = 0;
  let initiationFailures = 0;
  for (const row of rows.results ?? []) {
    const boundary = dueBoundary(row);
    if (boundary === null) continue;
    if (!row.payment_authorization_id || !row.provider) {
      await recordRenewalEvent(
        database,
        row.id,
        "RENEWAL_INITIATION_FAILED",
        {
          code: "RECURRING_AUTHORIZATION_MISSING",
        },
        now,
      );
      initiationFailures += 1;
      continue;
    }
    const created = await createPayment(database, registry, {
      purpose: "MEMBERSHIP_RENEWAL",
      subjectType: "subscription",
      subjectId: row.id,
      customerId: row.customer_id,
      amountMinor: row.fee_minor,
      currency: row.currency,
      providerCode: row.provider,
      returnUrl: RENEWAL_RETURN_URL,
      idempotencyKey: `renewal:${row.id}:${boundary}`,
      requestId: `renewal-${row.id}-${boundary}`,
    });
    if (!created.ok) {
      await recordRenewalEvent(
        database,
        row.id,
        "RENEWAL_INITIATION_FAILED",
        {
          code: created.error.code,
          message: created.error.message,
        },
        now,
      );
      initiationFailures += 1;
      continue;
    }
    await database
      .prepare(
        "UPDATE subscription SET renewal_initiated_through=?, version=version+1, updated_at=? WHERE id=? AND (renewal_initiated_through IS NULL OR renewal_initiated_through < ?)",
      )
      .bind(boundary, now, row.id, boundary)
      .run();
    initiated += 1;
  }
  return { initiated, initiationFailures };
}

async function applyConfirmedRenewalFailures(
  database: D1Database,
  now: number,
  limit: number,
): Promise<number> {
  // Only provider-confirmed failures count: an intent that reached FAILED
  // with at least one provider attempt. Creation-time operational failures
  // mark intents FAILED without attempts and must never read as payment
  // failures.
  const rows = await database
    .prepare(
      `SELECT i.id AS intent_id, i.subject_id AS subscription_id, i.updated_at AS failed_at
       FROM payment_intent i
       WHERE i.purpose='MEMBERSHIP_RENEWAL' AND i.status='FAILED'
         AND EXISTS (SELECT 1 FROM payment_attempt pa WHERE pa.payment_intent_id = i.id)
         AND EXISTS (SELECT 1 FROM subscription s WHERE s.id = i.subject_id AND s.status IN ('TRIALING','ACTIVE'))
         AND NOT EXISTS (SELECT 1 FROM subscription_event e WHERE e.payment_intent_id = i.id AND e.event_type='RENEWAL_FAILED')
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ intent_id: string; subscription_id: string; failed_at: number }>();

  let applied = 0;
  for (const row of rows.results ?? []) {
    const subscription = await database
      .prepare("SELECT id, status, version FROM subscription WHERE id=?")
      .bind(row.subscription_id)
      .first<{ id: string; status: string; version: number }>();
    if (!subscription || !["TRIALING", "ACTIVE"].includes(subscription.status)) continue;

    if (subscription.status === "TRIALING") {
      // A failed first conversion is an uncontinued trial: terminal EXPIRED
      // without a grace window (STATE_MACHINES.md).
      const updated = await database
        .prepare(
          "UPDATE subscription SET status='EXPIRED', ended_at=?, version=version+1, updated_at=? WHERE id=? AND status='TRIALING' AND version=?",
        )
        .bind(now, now, subscription.id, subscription.version)
        .run()
        .then((result) => (result.meta?.changes ?? 0) === 1);
      if (!updated) continue;
      await recordRenewalEvent(
        database,
        subscription.id,
        "RENEWAL_FAILED",
        {
          outcome: "TRIAL_UNCONTINUED",
          paymentIntentId: row.intent_id,
        },
        now,
        row.intent_id,
      );
      applied += 1;
      continue;
    }

    const repository = createMembershipRepository(database);
    const timeZone = await repository.marketTimezone();
    const graceEndsAtMs = Date.parse(
      addCalendarDays(new Date(row.failed_at).toISOString(), 7, timeZone),
    );
    const updated = await database
      .prepare(
        "UPDATE subscription SET status='PAST_DUE', grace_ends_at=?, version=version+1, updated_at=? WHERE id=? AND status='ACTIVE' AND version=?",
      )
      .bind(graceEndsAtMs, now, subscription.id, subscription.version)
      .run()
      .then((result) => (result.meta?.changes ?? 0) === 1);
    if (!updated) continue;
    await recordRenewalEvent(
      database,
      subscription.id,
      "RENEWAL_FAILED",
      {
        outcome: "PAST_DUE_WITH_GRACE",
        graceEndsAt: new Date(graceEndsAtMs).toISOString(),
        paymentIntentId: row.intent_id,
      },
      now,
      row.intent_id,
    );
    applied += 1;
  }
  return applied;
}

async function expireExhaustedGrace(
  database: D1Database,
  now: number,
  limit: number,
): Promise<number> {
  const rows = await database
    .prepare(
      `SELECT s.id, s.grace_ends_at FROM subscription s
       WHERE s.status='PAST_DUE' AND s.grace_ends_at IS NOT NULL AND s.grace_ends_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM payment_intent i
           WHERE i.subject_id = s.id AND i.purpose='MEMBERSHIP_RENEWAL'
             AND i.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING')
         )
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<{ id: string; grace_ends_at: number }>();

  let expired = 0;
  for (const row of rows.results ?? []) {
    const updated = await database
      .prepare(
        "UPDATE subscription SET status='EXPIRED', ended_at=?, version=version+1, updated_at=? WHERE id=? AND status='PAST_DUE' AND grace_ends_at=?",
      )
      .bind(now, now, row.id, row.grace_ends_at)
      .run()
      .then((result) => (result.meta?.changes ?? 0) === 1);
    if (!updated) continue;
    await recordRenewalEvent(database, row.id, "EXPIRED_FROM_GRACE", {}, now);
    expired += 1;
  }
  return expired;
}

function recordRenewalEvent(
  database: D1Database,
  subscriptionId: string,
  eventType: string,
  details: Record<string, unknown>,
  now: number,
  paymentIntentId?: string,
): Promise<unknown> {
  return database
    .prepare(
      "INSERT INTO subscription_event (id, subscription_id, event_type, payment_intent_id, actor_type, details_json, occurred_at, created_at) VALUES (?, ?, ?, ?, 'SYSTEM', ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      subscriptionId,
      eventType,
      paymentIntentId ?? null,
      JSON.stringify(details),
      now,
      now,
    )
    .run();
}
