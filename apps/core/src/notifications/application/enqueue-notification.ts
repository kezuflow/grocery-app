import { validateNotification, type NotificationType } from "../domain/notification";

export async function enqueueNotification(
  database: D1Database,
  input: {
    type: NotificationType;
    aggregateType: string;
    aggregateId: string;
    customerId: string;
    recipient: string;
    templateData: Record<string, unknown>;
    scheduledAt: number;
    idempotencyKey: string;
  },
) {
  const valid = validateNotification(input);
  if (!valid.ok) return { ok: false as const, code: valid.code };
  const now = Date.now();
  await database
    .prepare(
      `INSERT OR IGNORE INTO notification_outbox
     (id,event_type,aggregate_type,aggregate_id,customer_id,channel,recipient_snapshot,
      template_data_json,status,scheduled_at,available_at,attempts,idempotency_key,created_at,updated_at)
     VALUES (?,?,?,?,?,'EMAIL',?,?,'PENDING',?,?,0,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.type,
      input.aggregateType,
      input.aggregateId,
      input.customerId,
      input.recipient,
      valid.encoded,
      input.scheduledAt,
      input.scheduledAt,
      input.idempotencyKey,
      now,
      now,
    )
    .run();
  const row = await database
    .prepare("SELECT id,status FROM notification_outbox WHERE idempotency_key=?")
    .bind(input.idempotencyKey)
    .first<{ id: string; status: string }>();
  return row
    ? { ok: true as const, value: row }
    : { ok: false as const, code: "PERSISTENCE_FAILED" };
}
