export type ScheduledCancellationOutcome = {
  subscriptionId: string;
  applied: boolean;
  reason?: "NOT_DUE_YET" | "NO_INTENT" | "STALE_VERSION" | "APPLIED";
};

/**
 * Time-driven application of due period-end cancellations. Selects due
 * records, then invokes the idempotent effective-time command per aggregate;
 * safe to call repeatedly from reconciliation or manual operations.
 */
export async function applyScheduledCancellations(
  database: D1Database,
  now: number,
  limit = 50,
): Promise<ScheduledCancellationOutcome[]> {
  const due = await database
    .prepare(
      "SELECT id, status FROM subscription WHERE cancel_at_period_end=1 AND status IN ('TRIALING','ACTIVE','PAST_DUE') AND COALESCE(scheduled_cancellation_at, trial_ends_at, current_period_ends_at) <= ? ORDER BY updated_at ASC LIMIT ?",
    )
    .bind(now, limit)
    .all<{ id: string }>();

  const outcomes: ScheduledCancellationOutcome[] = [];
  for (const row of due.results) {
    const idempotencyKey = `apply-cancel:${row.id}`;
    const record = await database
      .prepare(
        "SELECT status FROM idempotency_records WHERE scope='membership.applyCancel' AND idempotency_key=?",
      )
      .bind(idempotencyKey)
      .first<{ status: string }>();
    if (record?.status === "SUCCEEDED") {
      outcomes.push({ subscriptionId: row.id, applied: true, reason: "APPLIED" });
      continue;
    }
    const claimed = await database
      .prepare(
        "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, result_reference, status, created_at, updated_at) VALUES ('membership.applyCancel', ?, 'deterministic', 'subscription', ?, 'PROCESSING', ?, ?)",
      )
      .bind(idempotencyKey, row.id, Date.now(), Date.now())
      .run()
      .then((result) => (result.meta?.changes ?? 0) === 1);
    if (!claimed) {
      outcomes.push({ subscriptionId: row.id, applied: false, reason: "NOT_DUE_YET" });
      continue;
    }
    const applied = await database
      .prepare(
        "UPDATE subscription SET status='CANCELED', ended_at=?, version=version+1, updated_at=? WHERE id=? AND status IN ('TRIALING','ACTIVE','PAST_DUE') AND cancel_at_period_end=1",
      )
      .bind(now, now, row.id)
      .run()
      .then((result) => (result.meta?.changes ?? 0) === 1);
    if (!applied) {
      await database
        .prepare(
          "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope='membership.applyCancel' AND idempotency_key=?",
        )
        .bind(now, idempotencyKey)
        .run();
      outcomes.push({ subscriptionId: row.id, applied: false, reason: "STALE_VERSION" });
      continue;
    }
    await database
      .prepare(
        "INSERT INTO subscription_event (id, subscription_id, event_type, actor_type, details_json, occurred_at, created_at) VALUES (?, ?, 'SCHEDULED_CANCELLATION_APPLIED', 'SYSTEM', '{}', ?, ?)",
      )
      .bind(crypto.randomUUID(), row.id, now, now)
      .run();
    await database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', updated_at=? WHERE scope='membership.applyCancel' AND idempotency_key=?",
      )
      .bind(now, idempotencyKey)
      .run();
    outcomes.push({ subscriptionId: row.id, applied: true, reason: "APPLIED" });
  }
  return outcomes;
}
