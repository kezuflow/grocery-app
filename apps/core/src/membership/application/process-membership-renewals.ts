/**
 * Application-owned membership time processing.
 *
 * FreshMarkets expires its own no-payment introductory trials. PayMongo owns
 * paid subscription invoice creation and every payment retry; those outcomes
 * arrive through verified provider events and reconciliation.
 */

export type MembershipTimeStepOutcome = {
  trialsExpired: number;
};

export async function processMembershipRenewals(
  database: D1Database,
  now: number,
  limit = 25,
): Promise<MembershipTimeStepOutcome> {
  return { trialsExpired: await expireEndedTrials(database, now, limit) };
}

async function expireEndedTrials(
  database: D1Database,
  now: number,
  limit: number,
): Promise<number> {
  const rows = await database
    .prepare(
      `SELECT id, trial_ends_at, version FROM subscription
       WHERE status='TRIALING' AND cancel_at_period_end=0
         AND trial_ends_at IS NOT NULL AND trial_ends_at <= ?
       ORDER BY trial_ends_at ASC, id ASC LIMIT ?`,
    )
    .bind(now, limit)
    .all<{ id: string; trial_ends_at: number; version: number }>();

  let expired = 0;
  for (const row of rows.results ?? []) {
    const updated = await database
      .prepare(
        "UPDATE subscription SET status='EXPIRED', ended_at=?, version=version+1, updated_at=? WHERE id=? AND status='TRIALING' AND trial_ends_at=? AND version=?",
      )
      .bind(row.trial_ends_at, now, row.id, row.trial_ends_at, row.version)
      .run()
      .then((result) => (result.meta?.changes ?? 0) === 1);
    if (!updated) continue;
    await database
      .prepare(
        "INSERT INTO subscription_event (id, subscription_id, event_type, actor_type, details_json, occurred_at, created_at) VALUES (?, ?, 'TRIAL_EXPIRED', 'SYSTEM', ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        row.id,
        JSON.stringify({ trialEndedAt: new Date(row.trial_ends_at).toISOString() }),
        now,
        now,
      )
      .run();
    expired += 1;
  }
  return expired;
}
