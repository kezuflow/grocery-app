/** Release only old intents that are definitely unsubmitted. CREATING and unknown outcomes
 * may have reached the provider and must remain under reconciliation instead.
 */
export async function expireUnsubmittedBookings(database: D1Database, now: number) {
  const cutoff = now - 300_000;
  const rows = await database
    .prepare(`SELECT dispatch.id,dispatch.version,dispatch.status,dispatch.updated_at,
    dispatch.client_idempotency_key,job.id job_id,job.status job_status,job.version job_version,job.location_id
    FROM delivery_provider_dispatch dispatch JOIN delivery_job job ON job.id=dispatch.delivery_job_id
    WHERE dispatch.method='EXTERNAL' AND dispatch.status IN ('PENDING','RETRY_REQUIRED') AND dispatch.updated_at<=?
      AND dispatch.provider_delivery_id IS NULL AND job.status IN ('UNASSIGNED','RETRY_SCHEDULED','FAILED')
      AND dispatch.attempt_sequence=(SELECT MAX(latest.attempt_sequence) FROM delivery_provider_dispatch latest WHERE latest.delivery_job_id=job.id)
      AND NOT EXISTS (SELECT 1 FROM delivery_provider_command command WHERE command.dispatch_id=dispatch.id AND command.operation='CANCEL' AND command.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED'))
      AND NOT EXISTS (SELECT 1 FROM idempotency_records receipt WHERE receipt.scope='admin.delivery.externalDispatch' AND receipt.idempotency_key=dispatch.client_idempotency_key AND receipt.status='SUCCEEDED')
    ORDER BY dispatch.updated_at,dispatch.id LIMIT 25`)
    .bind(cutoff)
    .all<{
      id: string;
      version: number;
      status: string;
      updated_at: number;
      client_idempotency_key: string | null;
      job_id: string;
      job_status: string;
      job_version: number;
      location_id: string;
    }>();
  let closed = 0;
  const guard = () =>
    database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()<>1");
  for (const row of rows.results) {
    try {
      await database.batch([
        database
          .prepare(`UPDATE delivery_provider_dispatch SET status='FAILED',last_error_code='BOOKING_NOT_SUBMITTED',version=version+1,updated_at=?
          WHERE id=? AND version=? AND status=? AND updated_at=? AND provider_delivery_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM delivery_provider_command command WHERE command.dispatch_id=? AND command.operation='CANCEL' AND command.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED'))
          AND NOT EXISTS (SELECT 1 FROM idempotency_records receipt WHERE receipt.scope='admin.delivery.externalDispatch' AND receipt.idempotency_key=? AND receipt.status='SUCCEEDED')`)
          .bind(
            now,
            row.id,
            row.version,
            row.status,
            row.updated_at,
            row.id,
            row.client_idempotency_key,
          ),
        guard(),
        database
          .prepare(
            "UPDATE delivery_job SET status='FAILED',version=version+1,updated_at=? WHERE id=? AND version=? AND status=?",
          )
          .bind(now, row.job_id, row.job_version, row.job_status),
        guard(),
        database
          .prepare(
            "UPDATE delivery_stop SET status='FAILED',version=version+1,updated_at=? WHERE delivery_job_id=? AND status=?",
          )
          .bind(now, row.job_id, row.job_status),
        guard(),
        database
          .prepare(
            "UPDATE idempotency_records SET status='FAILED',updated_at=? WHERE scope='admin.delivery.externalDispatch' AND idempotency_key=? AND status='PROCESSING'",
          )
          .bind(now, row.client_idempotency_key),
        database
          .prepare(`INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,occurred_at)
          VALUES (?,NULL,'DELIVERY.UNSUBMITTED_BOOKING_EXPIRED','delivery_provider_dispatch',?,?,?,?,?)`)
          .bind(
            `booking-expired:${row.id}`,
            row.id,
            JSON.stringify({ previousStatus: row.status, reason: "BOOKING_NOT_SUBMITTED" }),
            `booking-expired:${row.id}`,
            row.location_id,
            now,
          ),
        guard(),
      ]);
      closed++;
    } catch (error) {
      if (!(error instanceof Error) || !/constraint failed/i.test(error.message)) throw error;
      const current = await database
        .prepare(
          "SELECT dispatch.version,job.version job_version FROM delivery_provider_dispatch dispatch JOIN delivery_job job ON job.id=dispatch.delivery_job_id WHERE dispatch.id=?",
        )
        .bind(row.id)
        .first<{ version: number; job_version: number }>();
      if (current?.version === row.version && current.job_version === row.job_version) throw error;
      // A concurrent claim wins; never release its attempt or hide an unchanged-state failure.
    }
  }
  return closed;
}
