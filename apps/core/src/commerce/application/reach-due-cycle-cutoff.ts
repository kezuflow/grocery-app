/**
 * Time-driven claim of the DeliveryCycle OPEN -> CUTOFF_REACHED transition.
 * Exactly-once by construction: the conditional update claims each due row,
 * and repeated invocations observe no further eligible cycles.
 */
export async function reachDueCycleCutoff(database: D1Database, now: number): Promise<number> {
  const result = await database
    .prepare(
      "UPDATE delivery_cycle SET status='CUTOFF_REACHED', version=version+1 WHERE status='OPEN' AND cutoff_at <= ?",
    )
    .bind(now)
    .run();
  return result.meta?.changes ?? 0;
}
