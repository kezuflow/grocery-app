import { retryDelayMs, type NotificationType } from "../domain/notification";
import type { EmailDeliveryPort } from "../infrastructure/email-delivery-port";
import { renderEmail } from "../infrastructure/email-templates";

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
    const attempt = item.attempts + 1;
    const leased = await database
      .prepare(
        `UPDATE notification_outbox SET status='PROCESSING',attempts=?,available_at=?,updated_at=?
       WHERE id=? AND ((status='PENDING' AND available_at<=?) OR (status='PROCESSING' AND available_at<=?))`,
      )
      .bind(attempt, now + 5 * 60_000, now, item.id, now, now)
      .run();
    if ((leased.meta?.changes ?? 0) !== 1) continue;
    const attemptId = crypto.randomUUID();
    await database
      .prepare(
        "INSERT INTO notification_attempt (id,notification_id,status,attempted_at) VALUES (?,?,'PROCESSING',?)",
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
            "UPDATE notification_outbox SET status='SENT',sent_at=?,updated_at=? WHERE id=? AND status='PROCESSING'",
          )
          .bind(now, now, item.id),
      ]);
      delivered++;
    } else {
      const terminal = attempt >= 5;
      await database.batch([
        database
          .prepare(
            "UPDATE notification_attempt SET status='FAILED',error_code=?,completed_at=? WHERE id=?",
          )
          .bind(result.code.slice(0, 100), now, attemptId),
        database
          .prepare(
            "UPDATE notification_outbox SET status=?,last_error_code=?,available_at=?,updated_at=? WHERE id=? AND status='PROCESSING'",
          )
          .bind(
            terminal ? "FAILED" : "PENDING",
            result.code.slice(0, 100),
            now + retryDelayMs(attempt),
            now,
            item.id,
          ),
      ]);
    }
  }
  return { attempted: due.results.length, delivered };
}
