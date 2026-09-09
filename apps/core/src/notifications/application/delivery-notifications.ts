export type DeliveryNotificationType = "OUT_FOR_DELIVERY" | "DELIVERED" | "DELIVERY_FAILED";

/** Persist each attempt's customer update with its delivery transition, before Queue delivery. */
export function deliveryNotificationStatements(
  db: D1Database,
  dispatchId: string,
  type: DeliveryNotificationType,
  occurredAt: number,
): D1PreparedStatement[] {
  const key = `delivery:${dispatchId}:${type}`;
  return [
    db
      .prepare(`INSERT INTO notification_outbox
      (id,event_type,aggregate_type,aggregate_id,customer_id,channel,recipient_snapshot,
       template_data_json,status,scheduled_at,available_at,attempts,idempotency_key,
       last_error_code,created_at,updated_at)
      SELECT ?,?,'DELIVERY',o.id,o.customer_id,'EMAIL',COALESCE(u.email,''),
        json_object('orderNumber',COALESCE(o.order_number,o.id),'templateVersion',1),
        CASE WHEN u.email IS NULL OR u.email='' THEN 'FAILED' ELSE 'PENDING' END,
        ?,?,0,?,CASE WHEN u.email IS NULL OR u.email='' THEN 'RECIPIENT_UNAVAILABLE' END,?,?
      FROM delivery_provider_dispatch attempt JOIN delivery_job job ON job.id=attempt.delivery_job_id
      JOIN grocery_order o ON o.id=job.order_id JOIN customer c ON c.id=o.customer_id
      LEFT JOIN user u ON u.id=c.auth_user_id WHERE attempt.id=?
      ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(
        crypto.randomUUID(),
        type,
        occurredAt,
        occurredAt,
        key,
        occurredAt,
        occurredAt,
        dispatchId,
      ),
    db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE NOT EXISTS
      (SELECT 1 FROM notification_outbox WHERE idempotency_key=?)`)
      .bind(key),
  ];
}
