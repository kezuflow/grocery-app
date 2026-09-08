import { z } from "@freshmarkets/validation";
import { retryDelayMs, notificationTypes } from "../domain/notification";
import type { EmailDeliveryPort, EmailSendOutcome } from "../infrastructure/email-delivery-port";
import { renderEmail } from "../infrastructure/email-templates";

export type NotificationDeliveryOutcome = "SENT" | "ALREADY_SENT" | "RETRY" | "TERMINAL" | "BUSY";
const required = (db: D1Database) =>
  db.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1");
const templateSchema = z.record(z.string(), z.unknown());
const invitationEligibility =
  "(staff_invitation_id IS NULL OR EXISTS(SELECT 1 FROM staff_invitation i WHERE i.id=notification_outbox.staff_invitation_id AND i.status='PENDING' AND i.expires_at>? AND i.email_normalized=notification_outbox.recipient_snapshot)) AND (customer_invitation_id IS NULL OR EXISTS(SELECT 1 FROM customer_invitation i WHERE i.id=notification_outbox.customer_invitation_id AND i.status='PENDING' AND i.expires_at>? AND i.email_normalized=notification_outbox.recipient_snapshot))";

export async function deliverNotificationById(
  database: D1Database,
  port: EmailDeliveryPort,
  id: string,
  now: number,
  applicationOrigin?: string,
): Promise<NotificationDeliveryOutcome> {
  const item = await database
    .prepare(
      "SELECT id,event_type,recipient_snapshot,template_data_json,attempts,status,available_at,scheduled_at,customer_id,staff_invitation_id,customer_invitation_id FROM notification_outbox WHERE id=?",
    )
    .bind(id)
    .first<{
      id: string;
      event_type: string;
      recipient_snapshot: string;
      template_data_json: string;
      attempts: number;
      status: string;
      available_at: number;
      scheduled_at: number;
      customer_id: string | null;
      staff_invitation_id: string | null;
      customer_invitation_id: string | null;
    }>();
  if (!item) return "TERMINAL";
  if (item.status === "SENT") return "ALREADY_SENT";
  if (item.status === "FAILED" || item.status === "CANCELED") return "TERMINAL";
  if (item.available_at > now || item.scheduled_at > now) return "BUSY";
  if (item.status === "PROCESSING") {
    const uncertain = await database
      .prepare(
        "SELECT 1 FROM notification_attempt WHERE notification_id=? AND status='PROCESSING' LIMIT 1",
      )
      .bind(id)
      .first();
    if (uncertain) {
      await database
        .prepare(
          "UPDATE notification_outbox SET status='FAILED',last_error_code='SEND_OUTCOME_UNKNOWN',updated_at=? WHERE id=? AND status='PROCESSING' AND attempts=? AND available_at<=?",
        )
        .bind(now, id, item.attempts, now)
        .run();
      return "TERMINAL";
    }
  }
  if (item.attempts >= 5) {
    await database
      .prepare(
        "UPDATE notification_outbox SET status='FAILED',last_error_code='DELIVERY_ATTEMPTS_EXHAUSTED',updated_at=? WHERE id=? AND attempts=? AND status IN ('PENDING','PROCESSING') AND available_at<=?",
      )
      .bind(now, id, item.attempts, now)
      .run();
    return "TERMINAL";
  }
  let raw: unknown;
  try {
    raw = JSON.parse(item.template_data_json);
  } catch {
    raw = null;
  }
  const data = templateSchema.safeParse(raw);
  const type = z.enum(notificationTypes).safeParse(item.event_type);
  const recipientMatches =
    item.event_type === "STAFF_INVITED"
      ? item.staff_invitation_id !== null
      : item.event_type === "CUSTOMER_INVITED"
        ? item.customer_invitation_id !== null
        : item.customer_id !== null;
  if (!data.success || !type.success || !recipientMatches) {
    await database
      .prepare(
        "UPDATE notification_outbox SET status='FAILED',last_error_code='INVALID_NOTIFICATION_TEMPLATE',updated_at=? WHERE id=? AND attempts=? AND status IN ('PENDING','PROCESSING') AND available_at<=?",
      )
      .bind(now, id, item.attempts, now)
      .run();
    return "TERMINAL";
  }
  if (
    !(await database
      .prepare(`SELECT 1 FROM notification_outbox WHERE id=? AND ${invitationEligibility}`)
      .bind(id, now, now)
      .first())
  ) {
    await database
      .prepare(
        `UPDATE notification_outbox SET status='CANCELED',last_error_code='INVITATION_UNAVAILABLE',updated_at=? WHERE id=? AND attempts=? AND status IN ('PENDING','PROCESSING') AND available_at<=? AND NOT (${invitationEligibility})`,
      )
      .bind(now, id, item.attempts, now, now, now)
      .run();
    return "TERMINAL";
  }
  let template: ReturnType<typeof renderEmail>;
  try {
    template = renderEmail(type.data, data.data, applicationOrigin);
  } catch {
    await database
      .prepare(
        "UPDATE notification_outbox SET last_error_code='NOTIFICATION_TEMPLATE_UNAVAILABLE',updated_at=? WHERE id=? AND status='PENDING' AND attempts=?",
      )
      .bind(now, id, item.attempts)
      .run();
    return "RETRY";
  }
  const attempt = item.attempts + 1;
  const attemptId = `notification-send:${id}:${attempt}`;
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE notification_outbox SET status='PROCESSING',attempts=?,available_at=?,updated_at=? WHERE id=? AND attempts=? AND attempts<5 AND status IN ('PENDING','PROCESSING') AND available_at<=? AND scheduled_at<=? AND NOT EXISTS(SELECT 1 FROM notification_attempt WHERE notification_id=notification_outbox.id AND status='PROCESSING') AND ${invitationEligibility} AND event_type=? AND recipient_snapshot=? AND template_data_json=?`,
        )
        .bind(
          attempt,
          now + 5 * 60_000,
          now,
          id,
          item.attempts,
          now,
          now,
          now,
          now,
          item.event_type,
          item.recipient_snapshot,
          item.template_data_json,
        ),
      required(database),
      database
        .prepare(
          "INSERT INTO notification_attempt(id,notification_id,status,attempted_at) VALUES (?,?,'PROCESSING',?)",
        )
        .bind(attemptId, id, now),
      required(database),
    ]);
  } catch {
    return "BUSY";
  }
  let result: EmailSendOutcome;
  try {
    result = await port.send({
      recipient: item.recipient_snapshot,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
  } catch {
    result = { ok: false, code: "SEND_OUTCOME_UNKNOWN", outcome: "UNKNOWN" };
  }
  const unknown = !result.ok && result.outcome === "UNKNOWN";
  const terminal = !result.ok && (unknown || attempt >= 5);
  const errorCode = result.ok
    ? null
    : unknown
      ? "SEND_OUTCOME_UNKNOWN"
      : /^[A-Z][A-Z0-9_]{0,99}$/.test(result.code)
        ? result.code
        : "EMAIL_DELIVERY_REJECTED";
  // A late known result may close the same attempt after its expired-lease
  // observer reported uncertainty. It may never overwrite a later attempt.
  const predicate =
    "id=? AND attempts=? AND (status='PROCESSING' OR (status='FAILED' AND last_error_code='SEND_OUTCOME_UNKNOWN'))";
  try {
    await database.batch([
      result.ok
        ? database
            .prepare(
              `UPDATE notification_outbox SET status='SENT',sent_at=?,processed_at=?,updated_at=?,last_error_code=NULL WHERE ${predicate}`,
            )
            .bind(now, now, now, id, attempt)
        : database
            .prepare(
              `UPDATE notification_outbox SET status=?,last_error_code=?,available_at=?,updated_at=? WHERE ${predicate}`,
            )
            .bind(
              terminal ? "FAILED" : "PENDING",
              errorCode,
              now + retryDelayMs(attempt),
              now,
              id,
              attempt,
            ),
      required(database),
      database
        .prepare(
          "UPDATE notification_attempt SET status=?,error_code=?,completed_at=? WHERE id=? AND notification_id=? AND status='PROCESSING'",
        )
        .bind(result.ok ? "SENT" : "FAILED", errorCode, now, attemptId, id),
      required(database),
    ]);
  } catch {
    const current = await database
      .prepare("SELECT status FROM notification_outbox WHERE id=?")
      .bind(id)
      .first<{ status: string }>();
    return current?.status === "SENT" ? "ALREADY_SENT" : "BUSY";
  }
  return result.ok ? "SENT" : terminal ? "TERMINAL" : "RETRY";
}

export async function deliverNotifications(
  database: D1Database,
  port: EmailDeliveryPort,
  now: number,
  limit = 25,
  applicationOrigin?: string,
) {
  const due = await database
    .prepare(
      `SELECT id FROM notification_outbox
     WHERE ((status='PENDING' AND scheduled_at<=? AND available_at<=?) OR (status='PROCESSING' AND available_at<=?))
       ORDER BY scheduled_at,id LIMIT ?`,
    )
    .bind(now, now, now, limit)
    .all<{
      id: string;
    }>();
  let delivered = 0;
  for (const item of due.results) {
    if ((await deliverNotificationById(database, port, item.id, now, applicationOrigin)) === "SENT")
      delivered++;
  }
  return { attempted: due.results.length, delivered };
}
