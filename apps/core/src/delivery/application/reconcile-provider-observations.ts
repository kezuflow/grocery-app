import { applyProviderObservation } from "./apply-provider-observation";
import type { ProviderDeliveryStatus } from "../ports/delivery-provider";

function status(value: string): ProviderDeliveryStatus | null {
  switch (value) {
    case "ALLOCATING":
    case "PENDING_PICKUP":
    case "PICKING_UP":
    case "PENDING_DROP_OFF":
    case "IN_DELIVERY":
    case "IN_RETURN":
    case "COMPLETED":
    case "CANCELED":
    case "RETURNED":
    case "FAILED":
      return value;
    default:
      return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Local evidence replay only: never creates, cancels, or rebooks a courier. */
export async function reconcileProviderObservations(database: D1Database, now: number) {
  // A lost read response is safe to retry. Never reclaim an uncertain mutation.
  await database.batch([
    database
      .prepare(`UPDATE delivery_provider_command SET status='REJECTED',updated_at=?
      WHERE operation='REFRESH' AND status='SUBMITTING' AND updated_at<?`)
      .bind(now, now - 300_000),
    database
      .prepare(`UPDATE idempotency_records SET status='FAILED',updated_at=?
      WHERE status='PROCESSING' AND EXISTS (SELECT 1 FROM delivery_provider_command command
        WHERE command.operation='REFRESH' AND command.status='REJECTED' AND command.idempotency_scope=scope
          AND command.idempotency_key=idempotency_records.idempotency_key AND command.request_hash=idempotency_records.request_hash)`)
      .bind(now),
  ]);
  const pending = await database
    .prepare(`SELECT inbox.id,inbox.provider_status,inbox.observed_at,inbox.raw_payload,
    inbox.recovery_attempts,dispatch.id AS dispatch_id
    FROM delivery_provider_event_inbox inbox LEFT JOIN delivery_provider_dispatch dispatch
      ON dispatch.provider=inbox.provider AND dispatch.provider_delivery_id=inbox.provider_delivery_id
    WHERE inbox.processing_status!='APPLIED' AND inbox.recovery_attempts<5 AND inbox.next_recovery_at<=?
    ORDER BY inbox.received_at,inbox.id LIMIT 25`)
    .bind(now)
    .all<{
      id: string;
      provider_status: string;
      observed_at: number;
      raw_payload: string;
      recovery_attempts: number;
      dispatch_id: string | null;
    }>();
  let attempted = 0;
  let applied = 0;
  let deferred = 0;
  for (const row of pending.results) {
    const claim = await database
      .prepare(`UPDATE delivery_provider_event_inbox SET recovery_attempts=recovery_attempts+1,next_recovery_at=?
      WHERE id=? AND recovery_attempts=? AND next_recovery_at<=? AND processing_status!='APPLIED'`)
      .bind(now + 60_000 * 2 ** row.recovery_attempts, row.id, row.recovery_attempts, now)
      .run();
    if (claim.meta.changes !== 1) continue;
    attempted += 1;
    let failure: string | null = null;
    const normalized = status(row.provider_status);
    let raw: Record<string, unknown> | null = null;
    try {
      raw = object(JSON.parse(row.raw_payload));
    } catch {
      failure = "DELIVERY_EVIDENCE_INVALID";
    }
    if (!normalized) failure = "DELIVERY_STATUS_UNKNOWN";
    if (!row.dispatch_id) failure = "DELIVERY_DISPATCH_NOT_FOUND";
    if (!failure && normalized && row.dispatch_id) {
      const order = object(object(raw?.data)?.order);
      const tracking = raw?.trackingUrl ?? order?.shareLink;
      try {
        const result = await applyProviderObservation(
          database,
          {
            dispatchId: row.dispatch_id,
            status: normalized,
            observedAt: row.observed_at,
            trackingUrl: typeof tracking === "string" ? tracking : null,
            pickupPin: typeof raw?.pickupPin === "string" ? raw.pickupPin : null,
          },
          { inboxId: row.id },
        );
        if (result.outcome !== "RECONCILIATION_REQUIRED") {
          applied += 1;
          continue;
        }
        failure = result.reason ?? "DELIVERY_RECONCILIATION_REQUIRED";
      } catch {
        // Persist a bounded retry instead of losing the verified observation.
        failure = "DELIVERY_OBSERVATION_APPLICATION_FAILED";
      }
    }
    await database
      .prepare(`UPDATE delivery_provider_event_inbox SET processing_status='RECONCILIATION_REQUIRED',last_error_code=?
      WHERE id=? AND processing_status!='APPLIED'`)
      .bind(failure, row.id)
      .run();
    deferred += 1;
  }
  return { attempted, applied, deferred };
}
