/** These two recipient relationships are distinct from provisioned Customers. */
export type InvitationRecipientKind = "staff" | "customer";
const required = (db: D1Database) =>
  db.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1");
export function invitationNotificationStatements(
  db: D1Database,
  kind: InvitationRecipientKind,
  invitationId: string,
  now: number,
): D1PreparedStatement[] {
  const table = kind === "staff" ? "staff_invitation" : "customer_invitation";
  const event = kind === "staff" ? "STAFF_INVITED" : "CUSTOMER_INVITED";
  return [
    db
      .prepare(`INSERT INTO notification_outbox(id,event_type,aggregate_type,aggregate_id,${table}_id,channel,recipient_snapshot,template_data_json,status,scheduled_at,available_at,idempotency_key,created_at,updated_at)
    SELECT ?,?, ?,id,id,'EMAIL',email_normalized,json_object('expiresAt',expires_at),'PENDING',?,?,?, ?,? FROM ${table} WHERE id=? AND status='PENDING' AND expires_at>?`)
      .bind(
        crypto.randomUUID(),
        event,
        table,
        now,
        now,
        `invitation-email:${kind}:${invitationId}`,
        now,
        now,
        invitationId,
        now,
      ),
    required(db),
  ];
}
export function cancelPendingInvitationNotificationStatements(
  db: D1Database,
  kind: InvitationRecipientKind,
  invitationId: string,
  now: number,
): D1PreparedStatement[] {
  const column = kind === "staff" ? "staff_invitation_id" : "customer_invitation_id";
  return [
    db
      .prepare(
        `UPDATE notification_outbox SET status='CANCELED',last_error_code='INVITATION_UNAVAILABLE',updated_at=? WHERE ${column}=? AND status='PENDING'`,
      )
      .bind(now, invitationId),
    db
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -36 WHERE EXISTS(SELECT 1 FROM notification_outbox WHERE ${column}=? AND status='PENDING')`,
      )
      .bind(invitationId),
  ];
}
/** Trusted enum determines SQL identifiers; no user text enters the expression. */
export function invitationEmailStatusSql(kind: InvitationRecipientKind): string {
  const table = kind === "staff" ? "staff_invitation" : "customer_invitation";
  return `COALESCE((SELECT CASE WHEN n.status='SENT' THEN 'ACCEPTED' WHEN n.last_error_code='SEND_OUTCOME_UNKNOWN' THEN 'OUTCOME_UNKNOWN' WHEN n.status='CANCELED' THEN 'CANCELED' WHEN n.status='FAILED' OR n.publication_status='DEAD_LETTERED' THEN 'FAILED' WHEN n.status='PROCESSING' THEN 'SENDING' ELSE 'QUEUED' END FROM notification_outbox n WHERE n.${table}_id=${table}.id),'NOT_REQUESTED')`;
}
