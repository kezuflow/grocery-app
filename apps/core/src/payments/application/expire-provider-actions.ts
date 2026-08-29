/** Expire resumable provider actions after their provider-neutral deadline. */
export async function expireProviderActions(database: D1Database, now: number): Promise<number> {
  return database
    .prepare(
      "UPDATE payment_provider_action SET status='EXPIRED', updated_at=? WHERE status='ACTIVE' AND expires_at<=?",
    )
    .bind(now, now)
    .run()
    .then((outcome) => outcome.meta?.changes ?? 0);
}
