import { auditEventStatement } from "../../audit/application/append-audit-event";

/** Bounded, replay-safe opening. Cutoff remains authoritative even after scheduler downtime. */
export async function openDueDeliveryCycles(database: D1Database, now: number): Promise<number> {
  const eligible = `c.status='SCHEDULED' AND c.order_opens_at<=? AND c.order_opens_at<c.cutoff_at
    AND EXISTS (SELECT 1 FROM delivery_cycle_schedule s WHERE s.cycle_id=c.id
      AND c.cutoff_at<=s.procurement_at AND s.procurement_at<=s.preparation_at AND s.preparation_at<=s.pickup_at
      AND EXISTS (SELECT 1 FROM delivery_cycle_window w WHERE w.cycle_id=c.id)
      AND NOT EXISTS (SELECT 1 FROM delivery_cycle_window w WHERE w.cycle_id=c.id AND (w.starts_at<s.pickup_at OR w.ends_at<=w.starts_at)))
    AND EXISTS (SELECT 1 FROM delivery_cycle_zone p WHERE p.cycle_id=c.id AND p.status='ACTIVE')`;
  const due = await database
    .prepare(
      `SELECT c.id,c.market_id marketId,c.version FROM delivery_cycle c WHERE ${eligible} ORDER BY c.order_opens_at,c.id LIMIT 100`,
    )
    .bind(now)
    .all<{ id: string; marketId: string; version: number }>();
  let opened = 0;
  for (const cycle of due.results) {
    const key = `cycle-open:${cycle.id}:${cycle.version}`;
    const required = () =>
      database.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
    try {
      await database.batch([
        database
          .prepare(
            `UPDATE delivery_cycle AS c SET status='OPEN',version=version+1 WHERE c.id=? AND c.version=? AND ${eligible}`,
          )
          .bind(cycle.id, cycle.version, now),
        required(),
        auditEventStatement(database, {
          actorUserId: null,
          action: "delivery_cycle.opened",
          resourceType: "delivery_cycle",
          resourceId: cycle.id,
          marketId: cycle.marketId,
          correlationId: key,
          idempotencyKey: key,
          occurredAt: now,
          before: { status: "SCHEDULED", version: cycle.version },
          after: { status: "OPEN", version: cycle.version + 1 },
        }),
        required(),
        database
          .prepare(
            "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,result_reference,created_at,updated_at) VALUES ('commerce.cycle-open',?,?,'SUCCEEDED','delivery_cycle',?,?,?)",
          )
          .bind(
            key,
            key,
            JSON.stringify({ cycleId: cycle.id, status: "OPEN", version: cycle.version + 1 }),
            now,
            now,
          ),
        required(),
      ]);
      opened += 1;
    } catch (error) {
      const current = await database
        .prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
        .bind(cycle.id)
        .first<{ status: string; version: number }>();
      // A concurrent transition won. A failed required effect on our unchanged row needs recovery.
      if (!current || (current.status === "SCHEDULED" && current.version === cycle.version))
        throw error;
    }
  }
  return opened;
}
