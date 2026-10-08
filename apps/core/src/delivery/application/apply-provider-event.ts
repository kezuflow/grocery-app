import { providerEvidenceStatements } from "./provider-evidence-statements";
import { applyProviderObservation } from "./apply-provider-observation";
import type { ProviderEvent } from "../ports/provider-event";
import { applySharedDeliveryEvent } from "./apply-shared-delivery-event";

type Dispatch = {
  id: string;
  merchant_order_id: string;
  provider_delivery_id: string;
  version: number;
  handed_over_at: number | null;
  provider_status: string | null;
};
const currentAttempt = `NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch newer WHERE newer.delivery_job_id=delivery_provider_dispatch.delivery_job_id AND newer.attempt_sequence>delivery_provider_dispatch.attempt_sequence)`;

/** Evidence changes and their inbox receipt commit together. Never books a courier. */
export async function applyProviderEvent(
  database: D1Database,
  event: ProviderEvent,
  inboxId: string,
) {
  const now = Date.now();
  const defer = async (reason: string) => {
    await database
      .prepare(
        `UPDATE delivery_provider_event_inbox SET processing_status='RECONCILIATION_REQUIRED',last_error_code=? WHERE id=? AND processing_status!='APPLIED'`,
      )
      .bind(reason, inboxId)
      .run();
    return { outcome: "RECONCILIATION_REQUIRED" as const, reason };
  };
  const receipt = (dispatch?: Dispatch) =>
    database
      .prepare(
        `UPDATE delivery_provider_event_inbox SET processing_status='APPLIED',processed_at=?,last_error_code=NULL,dispatch_id=?,merchant_order_id=? WHERE id=?`,
      )
      .bind(now, dispatch?.id ?? null, dispatch?.merchant_order_id ?? "UNKNOWN", inboxId);
  if (event.kind === "UNKNOWN") return defer("LALAMOVE_EVENT_REQUIRES_RECONCILIATION");
  if (event.kind === "WALLET") {
    await database.batch([
      receipt(),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
    ]);
    return { outcome: "APPLIED" as const };
  }
  const lookupId = event.previousProviderDeliveryId ?? event.providerDeliveryId;
  const shared = await database
    .prepare(`SELECT id FROM delivery_shared_booking WHERE provider_delivery_id=?
    OR id IN (SELECT booking_id FROM delivery_shared_booking_identity WHERE provider_delivery_id=?)
    OR (merchant_order_id=? AND provider_delivery_id IS NULL AND status IN ('CREATING','OUTCOME_UNKNOWN','RECONCILIATION_REQUIRED'))`)
    .bind(lookupId, lookupId, event.merchantOrderId ?? "")
    .first<{ id: string }>();
  if (shared) return applySharedDeliveryEvent(database, shared.id, event, inboxId);
  const dispatch = await database
    .prepare(
      `SELECT id,merchant_order_id,provider_delivery_id,version,handed_over_at,provider_status FROM delivery_provider_dispatch WHERE provider='lalamove' AND (provider_delivery_id=? OR id IN (SELECT dispatch_id FROM delivery_provider_identity WHERE provider='lalamove' AND provider_delivery_id=?))`,
    )
    .bind(lookupId, lookupId)
    .first<Dispatch>();
  if (!dispatch) return defer("DELIVERY_DISPATCH_NOT_FOUND");
  if (
    !(await database
      .prepare(`SELECT id FROM delivery_provider_dispatch WHERE id=? AND ${currentAttempt}`)
      .bind(dispatch.id)
      .first())
  )
    return defer("DELIVERY_ATTEMPT_SUPERSEDED");
  // Retired identities remain evidence only; they cannot cancel or complete the replacement.
  if (dispatch.provider_delivery_id !== lookupId) {
    if (event.kind === "REPLACEMENT") {
      const successor = await database
        .prepare(
          `SELECT provider_delivery_id FROM delivery_provider_identity WHERE provider='lalamove' AND previous_provider_delivery_id=?`,
        )
        .bind(lookupId)
        .first<{ provider_delivery_id: string }>();
      if (successor?.provider_delivery_id !== event.providerDeliveryId)
        return defer("DELIVERY_REPLACEMENT_CONFLICT");
    }
    await receipt(dispatch).run();
    return { outcome: "OLDER" as const };
  }
  const evidenceStatements = providerEvidenceStatements(
    database,
    dispatch.id,
    event.observedAt,
    event.evidence,
  );
  if ((event.kind === "STATUS" || event.kind === "CREATED") && event.status) {
    return applyProviderObservation(
      database,
      {
        dispatchId: dispatch.id,
        status: event.status,
        observedAt: event.observedAt,
        trackingUrl: event.trackingUrl ?? null,
        driverId: event.driverId,
        replacementCheck: event.replacementCheck,
      },
      { inboxId, expectedVersion: dispatch.version, completionStatements: evidenceStatements },
    );
  }
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch WHERE id=? AND version=? AND provider_delivery_id=? AND ${currentAttempt})`,
      )
      .bind(dispatch.id, dispatch.version, lookupId),
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_event_inbox WHERE id=? AND processing_status!='APPLIED')`,
      )
      .bind(inboxId),
  ];
  if (event.kind === "REPLACEMENT") {
    if (["COMPLETED", "RETURNED"].includes(dispatch.provider_status ?? ""))
      return defer("DELIVERY_TERMINAL_CONFLICT");
    const conflict = await database
      .prepare(
        `SELECT 1 FROM delivery_provider_identity WHERE provider='lalamove' AND (provider_delivery_id=? OR previous_provider_delivery_id=?) UNION ALL SELECT 1 FROM delivery_provider_dispatch WHERE provider='lalamove' AND provider_delivery_id=? AND id!=?`,
      )
      .bind(event.providerDeliveryId, lookupId, event.providerDeliveryId, dispatch.id)
      .first();
    if (conflict) return defer("DELIVERY_REPLACEMENT_CONFLICT");
    statements.push(
      database
        .prepare(`DELETE FROM delivery_provider_evidence WHERE dispatch_id=?`)
        .bind(dispatch.id),
      database
        .prepare(
          `INSERT OR IGNORE INTO delivery_provider_identity(provider,provider_delivery_id,dispatch_id,observed_at) VALUES ('lalamove',?,?,?)`,
        )
        .bind(lookupId, dispatch.id, event.observedAt),
      database
        .prepare(
          `INSERT INTO delivery_provider_identity(provider,provider_delivery_id,dispatch_id,previous_provider_delivery_id,observed_at) VALUES ('lalamove',?,?,?,?)`,
        )
        .bind(event.providerDeliveryId, dispatch.id, lookupId, event.observedAt),
      database
        .prepare(
          `UPDATE delivery_provider_dispatch SET provider_delivery_id=?,provider_status='ALLOCATING',provider_status_rank=10,provider_observed_at=?,status='ACTIVE',replacement_pending=0,driver_id=NULL,driver_observed_at=?,tracking_url=NULL,custody_review_required=CASE WHEN handed_over_at IS NOT NULL THEN 1 ELSE 0 END,version=version+1,updated_at=? WHERE id=?`,
        )
        .bind(event.providerDeliveryId, event.observedAt, event.observedAt, now, dispatch.id),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      database
        .prepare(
          `UPDATE delivery_job SET status='UNASSIGNED',version=version+1,updated_at=? WHERE id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?) AND ? IS NULL AND status='ASSIGNED'`,
        )
        .bind(now, dispatch.id, dispatch.handed_over_at),
      database
        .prepare(
          `UPDATE delivery_stop SET status='UNASSIGNED',version=version+1,updated_at=? WHERE delivery_job_id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?) AND ? IS NULL AND status='ASSIGNED'`,
        )
        .bind(now, dispatch.id, dispatch.handed_over_at),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -32 WHERE ? IS NULL AND (
        EXISTS (SELECT 1 FROM delivery_job WHERE id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?) AND status='ASSIGNED')
        OR EXISTS (SELECT 1 FROM delivery_stop WHERE delivery_job_id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?) AND status='ASSIGNED'))`)
        .bind(dispatch.handed_over_at, dispatch.id, dispatch.id),
    );
  } else if (event.kind === "DRIVER") {
    statements.push(
      database
        .prepare(
          `UPDATE delivery_provider_dispatch SET driver_id=?,driver_observed_at=?,version=version+1,updated_at=? WHERE id=? AND COALESCE(driver_observed_at,0)<? AND provider_status NOT IN ('COMPLETED','CANCELED','FAILED','RETURNED')`,
        )
        .bind(event.driverId, event.observedAt, now, dispatch.id, event.observedAt),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch WHERE id=? AND (
        provider_status IN ('COMPLETED','CANCELED','FAILED','RETURNED') OR driver_observed_at>? OR (driver_observed_at=? AND driver_id=?)))`)
        .bind(dispatch.id, event.observedAt, event.observedAt, event.driverId),
    );
  }
  if (event.evidence?.some((item) => item.kind === "EDIT"))
    statements.push(
      database
        .prepare(
          `UPDATE delivery_provider_dispatch SET route_review_required=1,version=version+1,updated_at=? WHERE id=?`,
        )
        .bind(now, dispatch.id),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
    );
  statements.push(
    ...evidenceStatements,
    receipt(dispatch),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
  );
  try {
    await database.batch(statements);
    return { outcome: "APPLIED" as const };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
      throw error;
    if (
      await database
        .prepare(
          `SELECT id FROM delivery_provider_event_inbox WHERE id=? AND processing_status='APPLIED'`,
        )
        .bind(inboxId)
        .first()
    )
      return { outcome: "DUPLICATE" as const };
    return defer("DELIVERY_DISPATCH_STALE");
  }
}
