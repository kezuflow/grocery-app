import type { EmailDeliveryPort } from "../infrastructure/email-delivery-port";
import { deliverNotificationById } from "./deliver-notifications";

export type NotificationQueueMessage = Readonly<{ outboxId: string }>;
export type NotificationQueueProducer = Readonly<{
  send(message: NotificationQueueMessage): Promise<unknown>;
}>;

export async function publishNotificationOutbox(
  database: D1Database,
  queue: NotificationQueueProducer,
  now: number,
  limit = 50,
) {
  const due = await database
    .prepare(
      `SELECT id,publication_attempts FROM notification_outbox
       WHERE status='PENDING' AND scheduled_at<=? AND available_at<=?
         AND (
           publication_status IN ('PENDING','FAILED') OR
           (publication_status='PUBLISHING' AND lease_expires_at<=?)
         )
       ORDER BY scheduled_at,id LIMIT ?`,
    )
    .bind(now, now, now, limit)
    .all<{ id: string; publication_attempts: number }>();
  let published = 0;
  for (const item of due.results) {
    const owner = crypto.randomUUID();
    const attempt = item.publication_attempts + 1;
    const claimed = await database
      .prepare(
        `UPDATE notification_outbox
         SET publication_status='PUBLISHING',publication_attempts=?,lease_owner=?,
             lease_expires_at=?,updated_at=?
         WHERE id=? AND publication_attempts=?
           AND (publication_status IN ('PENDING','FAILED') OR
                (publication_status='PUBLISHING' AND lease_expires_at<=?))`,
      )
      .bind(attempt, owner, now + 60_000, now, item.id, item.publication_attempts, now)
      .run();
    if ((claimed.meta?.changes ?? 0) !== 1) continue;
    try {
      // Queue payloads intentionally contain only the stable D1 outbox identity.
      await queue.send({ outboxId: item.id });
      await database
        .prepare(
          `UPDATE notification_outbox
           SET publication_status='PUBLISHED',queue_message_id=?,published_at=?,
               lease_owner=NULL,lease_expires_at=NULL,updated_at=?
           WHERE id=? AND publication_status='PUBLISHING' AND lease_owner=?`,
        )
        .bind(`notification:${item.id}:${attempt}`, now, now, item.id, owner)
        .run();
      published += 1;
    } catch {
      await database
        .prepare(
          `UPDATE notification_outbox
           SET publication_status='FAILED',lease_owner=NULL,lease_expires_at=NULL,
               last_error_code='QUEUE_PUBLISH_FAILED',updated_at=?
           WHERE id=? AND publication_status='PUBLISHING' AND lease_owner=?`,
        )
        .bind(now, item.id, owner)
        .run();
    }
  }
  return { attempted: due.results.length, published };
}

function validMessage(value: unknown): value is NotificationQueueMessage {
  return (
    value !== null &&
    typeof value === "object" &&
    "outboxId" in value &&
    typeof value.outboxId === "string" &&
    value.outboxId.length > 0 &&
    value.outboxId.length <= 200
  );
}

export async function consumeNotificationBatch(
  database: D1Database,
  email: EmailDeliveryPort,
  batch: MessageBatch<NotificationQueueMessage>,
  now: number,
  applicationOrigin?: string,
) {
  for (const message of batch.messages) {
    try {
      if (!validMessage(message.body)) {
        message.ack();
        continue;
      }
      const outcome = await deliverNotificationById(
        database,
        email,
        message.body.outboxId,
        now,
        applicationOrigin,
      );
      if (outcome === "RETRY" || outcome === "BUSY") {
        if (message.attempts >= 5)
          await database
            .prepare(
              `UPDATE notification_outbox SET publication_status='DEAD_LETTERED',
               dead_lettered_at=?,updated_at=? WHERE id=? AND status!='SENT'`,
            )
            .bind(now, now, message.body.outboxId)
            .run();
        message.retry();
      } else {
        message.ack();
      }
    } catch {
      message.retry();
    }
  }
}
