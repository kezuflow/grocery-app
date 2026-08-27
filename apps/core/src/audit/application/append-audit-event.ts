import { log } from "../../observability";

export type AuditEventAppend = {
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  reason?: string | null;
  details?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  correlationId: string;
  occurredAt: number;
};

/**
 * Prepared insert of one durable audit event so callers compose it inside
 * their transactional D1 batch — the material mutation and its audit evidence
 * commit together or not at all.
 */
export function auditEventStatement(
  database: D1Database,
  event: AuditEventAppend,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO audit_event (id, actor_user_id, action, aggregate_type, aggregate_id,
                                details_json, before_json, after_json, reason,
                                market_id, location_id, correlation_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      event.actorUserId,
      event.action,
      event.resourceType,
      event.resourceId,
      JSON.stringify(event.details ?? {}),
      event.before === undefined || event.before === null ? null : JSON.stringify(event.before),
      event.after === undefined || event.after === null ? null : JSON.stringify(event.after),
      event.reason ?? null,
      event.correlationId,
      event.occurredAt,
    );
}

/**
 * Stand-alone auditable append for commands that cannot batch the event with
 * their mutation. Append failures are logged at error level and returned so
 * callers decide whether the material result can stand without its evidence.
 */
export async function appendAuditEvent(
  database: D1Database,
  event: AuditEventAppend,
): Promise<boolean> {
  const result = await auditEventStatement(database, event).run();
  const appended = (result.meta?.changes ?? 0) === 1;
  if (!appended) {
    log("error", "audit.append_failed", {
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
    });
  }
  return appended;
}
