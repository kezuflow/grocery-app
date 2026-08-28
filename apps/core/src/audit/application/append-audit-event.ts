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
  idempotencyKey?: string | null;
  occurredAt: number;
};

export type AuditAppendGuard = {
  clause: string;
  binds: ReadonlyArray<unknown>;
};

const AUDIT_COLUMNS =
  "(id, actor_user_id, action, aggregate_type, aggregate_id, details_json, idempotency_key, before_json, after_json, reason, market_id, location_id, correlation_id, occurred_at)";
const AUDIT_VALUES = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)";

function auditBinds(event: AuditEventAppend): unknown[] {
  return [
    crypto.randomUUID(),
    event.actorUserId,
    event.action,
    event.resourceType,
    event.resourceId,
    JSON.stringify(event.details ?? {}),
    event.idempotencyKey ?? null,
    event.before === undefined || event.before === null ? null : JSON.stringify(event.before),
    event.after === undefined || event.after === null ? null : JSON.stringify(event.after),
    event.reason ?? null,
    event.correlationId,
    event.occurredAt,
  ];
}

/**
 * Prepared insert of one durable audit event so callers compose it inside
 * their transactional D1 batch — the material mutation and its audit evidence
 * commit together or not at all. With a version guard the insert degrades to
 * a no-op unless the guarded aggregate still carries the caller's expected
 * version, so a stale batch can never leave orphaned audit evidence behind.
 */
export function auditEventStatement(
  database: D1Database,
  event: AuditEventAppend,
  guard?: AuditAppendGuard,
): D1PreparedStatement {
  const binds = auditBinds(event);
  if (!guard) {
    return database
      .prepare(`INSERT INTO audit_event ${AUDIT_COLUMNS} VALUES ${AUDIT_VALUES}`)
      .bind(...binds);
  }
  return database
    .prepare(
      `INSERT INTO audit_event ${AUDIT_COLUMNS} SELECT ${AUDIT_VALUES.slice(1, -1)} WHERE ${guard.clause}`,
    )
    .bind(...binds, ...guard.binds);
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
