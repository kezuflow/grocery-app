import { retryDelayMs, type NotificationType } from "../domain/notification";
import type { EmailDeliveryPort } from "../infrastructure/email-delivery-port";
import { renderEmail } from "../infrastructure/email-templates";

export type NotificationDeliveryOutcome = "SENT" | "ALREADY_SENT" | "RETRY" | "TERMINAL" | "BUSY";

export async function deliverNotificationById(
  database: D1Database,
  port: EmailDeliveryPort,
  id: string,
  now: number,
): Promise<NotificationDeliveryOutcome> {
  const item = await database
    .prepare(
      `SELECT id,event_type,recipient_snapshot,template_data_json,attempts,status,available_at
       FROM notification_outbox WHERE id=?`,
    )
    .bind(id)
    .first<{
      id: string;
      event_type: NotificationType;
      recipient_snapshot: string;
      template_data_json: string;
      attempts: number;
      status: string;
      available_at: number;
    }>();
  if (!item) return "TERMINAL";
  if (item.status === "SENT") return "ALREADY_SENT";
  if (item.status === "FAILED" || item.status === "CANCELED") return "TERMINAL";
  if (item.status === "PROCESSING" && item.available_at > now) return "BUSY";
  if (item.status === "PROCESSING") {
    const uncertain = await database
      .prepare(
        "SELECT 1 AS found FROM notification_attempt WHERE notification_id=? AND status='PROCESSING' LIMIT 1",
      )
      .bind(item.id)
      .first();
    if (uncertain) {
      // The side effect may already have happened. Never send twice without a
      // provider idempotency contract; preserve evidence for operator review.
      await database
        .prepare(
          `UPDATE notification_outbox SET status='FAILED',last_error_code='SEND_OUTCOME_UNKNOWN',
           updated_at=? WHERE id=? AND status='PROCESSING'`,
        )
        .bind(now, item.id)
        .run();
      return "TERMINAL";
    }
  }
  const attempt = item.attempts + 1;
  const leased = await database
    .prepare(
      `UPDATE notification_outbox SET status='PROCESSING',attempts=?,available_at=?,updated_at=?
       WHERE id=? AND attempts=?
         AND ((status='PENDING' AND available_at<=?) OR (status='PROCESSING' AND available_at<=?))`,
    )
    .bind(attempt, now + 5 * 60_000, now, item.id, item.attempts, now, now)
    .run();
  if ((leased.meta?.changes ?? 0) !== 1) return "BUSY";
  const attemptId = `notification-send:${item.id}:${attempt}`;
  await database
    .prepare(
      "INSERT OR IGNORE INTO notification_attempt (id,notification_id,status,attempted_at) VALUES (?,?,'PROCESSING',?)",
    )
    .bind(attemptId, item.id, now)
    .run();
  const template = renderEmail(
    item.event_type,
    JSON.parse(item.template_data_json) as Record<string, unknown>,
  );
  const result = await port.send({
    recipient: item.recipient_snapshot,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
  if (result.ok) {
    await database.batch([
      database
        .prepare("UPDATE notification_attempt SET status='SENT',completed_at=? WHERE id=?")
        .bind(now, attemptId),
      database
        .prepare(
          `UPDATE notification_outbox
           SET status='SENT',sent_at=?,processed_at=?,updated_at=?
           WHERE id=? AND status='PROCESSING' AND attempts=?`,
        )
        .bind(now, now, now, item.id, attempt),
    ]);
    return "SENT";
  }
  const terminal = attempt >= 5;
  await database.batch([
    database
      .prepare(
        "UPDATE notification_attempt SET status='FAILED',error_code=?,completed_at=? WHERE id=?",
      )
      .bind(result.code.slice(0, 100), now, attemptId),
    database
      .prepare(
        `UPDATE notification_outbox SET status=?,last_error_code=?,available_at=?,updated_at=?
         WHERE id=? AND status='PROCESSING' AND attempts=?`,
      )
      .bind(
        terminal ? "FAILED" : "PENDING",
        result.code.slice(0, 100),
        now + retryDelayMs(attempt),
        now,
        item.id,
        attempt,
      ),
  ]);
  return terminal ? "TERMINAL" : "RETRY";
}

export async function deliverNotifications(
  database: D1Database,
  port: EmailDeliveryPort,
  now: number,
  limit = 25,
) {
  const due = await database
    .prepare(
      `SELECT id,event_type,recipient_snapshot,template_data_json,attempts FROM notification_outbox
     WHERE ((status='PENDING' AND scheduled_at<=? AND available_at<=?) OR (status='PROCESSING' AND available_at<=?))
       AND attempts<5 ORDER BY scheduled_at,id LIMIT ?`,
    )
    .bind(now, now, now, limit)
    .all<{
      id: string;
      event_type: NotificationType;
      recipient_snapshot: string;
      template_data_json: string;
      attempts: number;
    }>();
  let delivered = 0;
  for (const item of due.results) {
    if ((await deliverNotificationById(database, port, item.id, now)) === "SENT") delivered++;
  }
  return { attempted: due.results.length, delivered };
}
