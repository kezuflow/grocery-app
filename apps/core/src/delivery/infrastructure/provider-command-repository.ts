/** Complete the original authorized command from durable provider evidence. */
export function completeProviderCommandStatements(
  database: D1Database,
  inboxId: string,
  observedAt: number,
  now: number,
): D1PreparedStatement[] {
  return [
    database
      .prepare(`UPDATE delivery_provider_command SET observation_id=?,status='OBSERVED',updated_at=?
      WHERE operation='CANCEL' AND status IN ('SUBMITTING','OUTCOME_UNKNOWN') AND created_at<=?
        AND dispatch_id=(SELECT dispatch.id FROM delivery_provider_event_inbox inbox JOIN delivery_provider_dispatch dispatch
          ON dispatch.provider=inbox.provider AND dispatch.provider_delivery_id=inbox.provider_delivery_id
          WHERE inbox.id=? AND inbox.provider_status='CANCELED')`)
      .bind(inboxId, now, observedAt, inboxId),
    database
      .prepare(`UPDATE delivery_provider_command SET observation_id=?,status='REJECTED',updated_at=?
      WHERE operation='CANCEL' AND status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED') AND created_at<=?
        AND dispatch_id=(SELECT dispatch.id FROM delivery_provider_event_inbox inbox JOIN delivery_provider_dispatch dispatch
          ON dispatch.provider=inbox.provider AND dispatch.provider_delivery_id=inbox.provider_delivery_id
          WHERE inbox.id=? AND inbox.provider_status IN ('COMPLETED','FAILED','RETURNED') AND dispatch.provider_status=inbox.provider_status)`)
      .bind(inboxId, now, observedAt, inboxId),
    database
      .prepare(`UPDATE delivery_provider_command SET status='SUCCEEDED',updated_at=?
      WHERE observation_id=? AND status='OBSERVED' AND (operation='REFRESH' OR EXISTS
        (SELECT 1 FROM delivery_provider_dispatch dispatch WHERE dispatch.id=delivery_provider_command.dispatch_id AND dispatch.provider_status='CANCELED'))`)
      .bind(now, inboxId),
    database
      .prepare(`INSERT OR IGNORE INTO audit_event
      (id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,correlation_id,occurred_at)
      SELECT 'delivery-command-result:'||command.id,command.actor_user_id,
        CASE WHEN command.status='REJECTED' THEN 'DELIVERY.EXTERNAL_PROVIDER_CANCEL_REJECTED'
          WHEN command.operation='CANCEL' THEN 'DELIVERY.EXTERNAL_PROVIDER_CANCELED' ELSE 'DELIVERY.EXTERNAL_PROVIDER_REFRESHED' END,
        'delivery_provider_dispatch',command.dispatch_id,json_object('provider',dispatch.provider),command.idempotency_key,
        command.location_id,command.request_id,?
      FROM delivery_provider_command command JOIN delivery_provider_dispatch dispatch ON dispatch.id=command.dispatch_id
      WHERE command.observation_id=? AND command.status IN ('SUCCEEDED','REJECTED')`)
      .bind(now, inboxId),
    database
      .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',updated_at=?,result_reference=(
      SELECT command.dispatch_id FROM delivery_provider_command command WHERE command.observation_id=?)
      WHERE status='PROCESSING' AND EXISTS (SELECT 1 FROM delivery_provider_command command
        WHERE command.observation_id=? AND command.status='SUCCEEDED' AND command.idempotency_scope=scope
          AND command.idempotency_key=idempotency_records.idempotency_key AND command.request_hash=idempotency_records.request_hash)`)
      .bind(now, inboxId, inboxId),
    database
      .prepare(`UPDATE idempotency_records SET status='FAILED',updated_at=?
      WHERE status='PROCESSING' AND EXISTS (SELECT 1 FROM delivery_provider_command command
        WHERE command.observation_id=? AND command.status='REJECTED' AND command.idempotency_scope=scope
          AND command.idempotency_key=idempotency_records.idempotency_key AND command.request_hash=idempotency_records.request_hash)`)
      .bind(now, inboxId),
  ];
}
