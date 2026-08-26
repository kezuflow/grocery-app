const CLOSEOUT_CHAIN = [
  "CUTOFF_REACHED",
  "PROCUREMENT",
  "RECEIVING",
  "PACKING",
  "DISPATCHING",
  "DELIVERING",
  "CLOSED",
] as const;

export type CycleCloseoutSummary = { considered: number; closed: number };

/**
 * Advances fully completed cutoff-reached cycles to CLOSED through the legal
 * DeliveryCycle transition chain. A cycle is eligible only when its delivery
 * window has passed and no order or delivery job retains open work; the
 * intermediate operational states are recorded stepwise inside one atomic
 * batch so the machine never observes an illegal jump. Cycles that still
 * hold open work are never touched.
 */
export async function closeCompletedDeliveryCycles(
  database: D1Database,
  now: number,
): Promise<CycleCloseoutSummary> {
  const eligible = await database
    .prepare(
      "SELECT id FROM delivery_cycle WHERE status='CUTOFF_REACHED' AND delivery_date <= ? AND NOT EXISTS (SELECT 1 FROM grocery_order o WHERE o.cycle_id = delivery_cycle.id AND o.status NOT IN ('DELIVERED','CANCELED','REFUNDED')) AND NOT EXISTS (SELECT 1 FROM delivery_job j WHERE j.cycle_id = delivery_cycle.id AND j.status NOT IN ('DELIVERED','CANCELED'))",
    )
    .bind(now)
    .all<{ id: string }>();

  let closed = 0;
  for (const cycle of eligible.results) {
    const statements = CLOSEOUT_CHAIN.slice(0, -1).map((from, index) =>
      database
        .prepare("UPDATE delivery_cycle SET status=?, version=version+1 WHERE id=? AND status=?")
        .bind(CLOSEOUT_CHAIN[index + 1], cycle.id, from),
    );
    await database.batch([...statements]);
    const row = await database
      .prepare("SELECT status FROM delivery_cycle WHERE id=?")
      .bind(cycle.id)
      .first<{ status: string }>();
    if (row?.status === "CLOSED") closed += 1;
  }
  return { considered: eligible.results.length, closed };
}
