import { auditEventStatement } from "../../audit/application/append-audit-event";

/** Time-driven cutoff, with required audit and replay evidence in the winning transaction. */
export async function reachDueCycleCutoff(database: D1Database, now: number): Promise<number> {
  const due = await database
    .prepare(
      "SELECT id,market_id marketId,version FROM delivery_cycle WHERE status='OPEN' AND cutoff_at<=? ORDER BY cutoff_at,id LIMIT 100",
    )
    .bind(now)
    .all<{ id: string; marketId: string; version: number }>();
  let reached = 0;
  for (const cycle of due.results) {
    const key = `cycle-cutoff:${cycle.id}:${cycle.version}`;
    const required = () =>
      database.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
    try {
      await database.batch([
        database
          .prepare(
            "UPDATE delivery_cycle SET status='CUTOFF_REACHED',version=version+1 WHERE id=? AND version=? AND status='OPEN' AND cutoff_at<=?",
          )
          .bind(cycle.id, cycle.version, now),
        required(),
        auditEventStatement(database, {
          actorUserId: null,
          action: "delivery_cycle.cutoff_reached",
          resourceType: "delivery_cycle",
          resourceId: cycle.id,
          marketId: cycle.marketId,
          correlationId: key,
          idempotencyKey: key,
          occurredAt: now,
          before: { status: "OPEN", version: cycle.version },
          after: { status: "CUTOFF_REACHED", version: cycle.version + 1 },
        }),
        required(),
        database
          .prepare(
            "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,result_reference,created_at,updated_at) VALUES ('commerce.cycle-cutoff',?,?,'SUCCEEDED','delivery_cycle',?,?,?)",
          )
          .bind(
            key,
            key,
            JSON.stringify({
              cycleId: cycle.id,
              status: "CUTOFF_REACHED",
              version: cycle.version + 1,
            }),
            now,
            now,
          ),
        required(),
      ]);
      reached += 1;
    } catch (error) {
      const current = await database
        .prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
        .bind(cycle.id)
        .first<{ status: string; version: number }>();
      if (!current || (current.status === "OPEN" && current.version === cycle.version)) throw error;
    }
  }
  return reached;
}
