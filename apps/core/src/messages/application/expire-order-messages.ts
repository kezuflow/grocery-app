import {
  ACTIVE_MESSAGE_HOLD_SQL,
  MESSAGE_TTL_MS,
  messageExpiry,
  type MessageOrder,
} from "./shared";

type DueRow = MessageOrder;

/** Bounded scheduled retention sweep. D1 visibility is withdrawn atomically before
 * R2 deletion, which is retried independently until the object is gone. */
export async function expireOrderMessages(
  database: D1Database,
  bucket: R2Bucket | undefined,
  now: number,
  limit = 25,
): Promise<number> {
  const due = await database
    .prepare(`SELECT o.id,o.customer_id AS customerId,o.order_number AS orderNumber,
      o.status,c.last_message_at AS lastMessageAt,
      (SELECT location_id FROM order_fulfillment_snapshot WHERE order_id=o.id) AS locationId,
      CASE o.status
        WHEN 'DELIVERED' THEN (SELECT MAX(d.delivered_at) FROM delivery_job d WHERE d.order_id=o.id AND d.status='DELIVERED')
        WHEN 'CANCELED' THEN (SELECT MAX(x.updated_at) FROM order_cancellation x WHERE x.order_id=o.id AND x.status='COMPLETED')
        ELSE NULL END AS closedAt
      FROM order_conversation c JOIN grocery_order o ON o.id=c.order_id
      WHERE c.last_message_at IS NOT NULL AND c.last_message_at<=?
      ORDER BY c.last_message_at,c.order_id LIMIT ?`)
    .bind(now - MESSAGE_TTL_MS, limit)
    .all<DueRow>();
  let affected = 0;
  for (const order of due.results) {
    const expiry = await messageExpiry(database, order);
    if (expiry === null || expiry > now || order.lastMessageAt === null) continue;
    try {
      await database.batch([
        database
          .prepare(`UPDATE order_conversation SET last_message_at=NULL,acknowledgement_sent=0
            WHERE order_id=? AND last_message_at=? AND last_message_at<=?
            AND EXISTS(SELECT 1 FROM grocery_order o WHERE o.id=order_id AND
              ((o.status='DELIVERED' AND EXISTS(SELECT 1 FROM delivery_job d
                WHERE d.order_id=o.id AND d.status='DELIVERED' AND d.delivered_at<=?))
              OR (o.status='CANCELED' AND EXISTS(SELECT 1 FROM order_cancellation x
                WHERE x.order_id=o.id AND x.status='COMPLETED' AND x.updated_at<=?))))
            AND NOT EXISTS(SELECT 1 FROM grocery_order o WHERE o.id=order_id
              AND (${ACTIVE_MESSAGE_HOLD_SQL}))`)
          .bind(
            order.id,
            order.lastMessageAt,
            now - MESSAGE_TTL_MS,
            now - MESSAGE_TTL_MS,
            now - MESSAGE_TTL_MS,
          ),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -39 WHERE changes()<>1"),
        database
          .prepare(`DELETE FROM order_message_content WHERE message_id IN
            (SELECT id FROM order_message WHERE order_id=?)`)
          .bind(order.id),
        database
          .prepare(`UPDATE order_message_upload SET status='DELETE_PENDING',file_name=NULL,
            next_attempt_at=?,updated_at=? WHERE order_id=? AND status='ATTACHED'`)
          .bind(now, now, order.id),
        ...[
          `customer:${order.customerId}`,
          "admin",
          `order:${order.id}`,
          ...(order.locationId ? [`location:${order.locationId}`] : []),
        ].map((audience) =>
          database
            .prepare(`INSERT INTO order_message_revision(audience_key,revision,published_revision)
              VALUES (?,1,0) ON CONFLICT(audience_key) DO UPDATE SET revision=revision+1`)
            .bind(audience),
        ),
      ]);
      affected += 1;
    } catch {
      // A new message or hold won the race. A later sweep rechecks current facts.
    }
  }

  await database
    .prepare(`UPDATE order_message_upload SET status='DELETE_PENDING',file_name=NULL,
      next_attempt_at=?,updated_at=? WHERE id IN (
        SELECT id FROM order_message_upload WHERE message_id IS NULL
          AND status IN ('PENDING','UNKNOWN','STORED') AND created_at<=?
        ORDER BY created_at,id LIMIT ?)`)
    .bind(now, now, now - 24 * 60 * 60 * 1000, limit)
    .run();

  if (!bucket) return affected;
  const deletes = await database
    .prepare(`SELECT id,object_key AS objectKey,delete_attempts AS attempts
      FROM order_message_upload WHERE status='DELETE_PENDING'
        AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY updated_at,id LIMIT ?`)
    .bind(now, limit)
    .all<{ id: string; objectKey: string; attempts: number }>();
  for (const upload of deletes.results) {
    try {
      await bucket.delete(upload.objectKey);
      await database
        .prepare(`UPDATE order_message_upload SET status='DELETED',next_attempt_at=NULL,
          updated_at=? WHERE id=? AND status='DELETE_PENDING'`)
        .bind(now, upload.id)
        .run();
      affected += 1;
    } catch {
      const delay = Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(upload.attempts, 10));
      await database
        .prepare(`UPDATE order_message_upload SET delete_attempts=delete_attempts+1,
          next_attempt_at=?,updated_at=? WHERE id=? AND status='DELETE_PENDING'`)
        .bind(now + delay, now, upload.id)
        .run();
    }
  }
  return affected;
}
