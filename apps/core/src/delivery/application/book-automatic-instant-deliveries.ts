import { z } from "@freshmarkets/validation";
import type { DeliveryProvider } from "../ports/delivery-provider";
import { bookOrderDelivery } from "./book-order-delivery";

const selection = z.object({
  providerCode: z.literal("lalamove"),
  providerServiceType: z.string().min(1),
});
const MAX_SAFE_SUBMISSION_ATTEMPTS = 3;

async function closeExhaustedBookings(database: D1Database, now: number, orderId?: string) {
  const rows = await database
    .prepare(`SELECT dispatch.id,dispatch.version,dispatch.client_idempotency_key,
      job.id job_id,job.version job_version,job.status job_status,job.location_id
    FROM delivery_provider_dispatch dispatch JOIN delivery_job job ON job.id=dispatch.delivery_job_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=job.order_id AND fulfillment.location_id=job.location_id
    WHERE job.fulfillment_mode='INSTANT' AND job.status='UNASSIGNED'
      AND fulfillment.status IN ('PACKING','PACKED')
      AND dispatch.client_idempotency_key='auto-book:'||job.id
      AND dispatch.merchant_order_id='fm-auto-'||job.id
      AND dispatch.status='RETRY_REQUIRED' AND dispatch.attempt_count>=?
      AND dispatch.provider_delivery_id IS NULL
      AND (? IS NULL OR job.order_id=?)
    ORDER BY dispatch.updated_at,dispatch.id LIMIT 25`)
    .bind(MAX_SAFE_SUBMISSION_ATTEMPTS, orderId ?? null, orderId ?? null)
    .all<{
      id: string;
      version: number;
      client_idempotency_key: string;
      job_id: string;
      job_version: number;
      job_status: string;
      location_id: string;
    }>();
  let failed = 0;
  const guard = () =>
    database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()<>1");
  for (const row of rows.results) {
    try {
      await database.batch([
        database
          .prepare(`UPDATE delivery_provider_dispatch
            SET status='FAILED',last_error_code='AUTOMATIC_BOOKING_RETRIES_EXHAUSTED',version=version+1,updated_at=?
            WHERE id=? AND version=? AND status='RETRY_REQUIRED' AND provider_delivery_id IS NULL`)
          .bind(now, row.id, row.version),
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
          .prepare(`INSERT INTO audit_event
            (id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,occurred_at)
            VALUES (?,NULL,'DELIVERY.AUTOMATIC_BOOKING_FAILED','delivery_provider_dispatch',?,?,?,?,?)`)
          .bind(
            `auto-booking-failed:${row.id}`,
            row.id,
            JSON.stringify({ reason: "AUTOMATIC_BOOKING_RETRIES_EXHAUSTED" }),
            `auto-booking-failed:${row.id}`,
            row.location_id,
            now,
          ),
        guard(),
      ]);
      failed += 1;
    } catch (error) {
      if (!(error instanceof Error) || !/constraint failed/i.test(error.message)) throw error;
      // A concurrent booking/recovery update wins. Its current state is re-read next pass.
    }
  }
  return failed;
}

/**
 * Packing plus an unbooked Instant job is the durable first-booking intent.
 * Only definitely unsubmitted retryable failures reuse the same provider identity.
 */
export async function bookAutomaticInstantDeliveries(
  database: D1Database,
  providers: () => ReadonlyMap<string, DeliveryProvider>,
  now: number,
  orderId?: string,
) {
  const failed = await closeExhaustedBookings(database, now, orderId);
  const rows = await database
    .prepare(`SELECT job.id,job.order_id,job.location_id,job.version,
      snapshot.delivery_execution_snapshot_json selection
    FROM delivery_job job JOIN grocery_order grocery ON grocery.id=job.order_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=grocery.id AND fulfillment.location_id=job.location_id
    JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=grocery.id
    LEFT JOIN delivery_provider_dispatch automatic ON automatic.client_idempotency_key='auto-book:'||job.id
    LEFT JOIN idempotency_records receipt ON receipt.scope='admin.delivery.externalDispatch'
      AND receipt.idempotency_key='auto-book:'||job.id
    WHERE job.fulfillment_mode='INSTANT' AND job.status='UNASSIGNED'
      AND fulfillment.status IN ('PACKING','PACKED')
      AND grocery.status IN ('FULFILLMENT_PENDING','FULFILLMENT_READY')
      AND (? IS NULL OR grocery.id=?)
      AND (receipt.status IS NULL OR receipt.status='PROCESSING')
      AND (
        (automatic.id IS NULL AND NOT EXISTS (
          SELECT 1 FROM delivery_provider_dispatch other WHERE other.delivery_job_id=job.id
        )) OR
        (automatic.status IN ('PENDING','RETRY_REQUIRED')
          AND automatic.attempt_count<? AND automatic.provider_delivery_id IS NULL)
      )
    ORDER BY fulfillment.updated_at,job.id LIMIT 25`)
    .bind(orderId ?? null, orderId ?? null, MAX_SAFE_SUBMISSION_ATTEMPTS)
    .all<{
      id: string;
      order_id: string;
      location_id: string;
      version: number;
      selection: string | null;
    }>();
  let submitted = 0;
  let deferred = 0;
  for (const row of rows.results) {
    let chosen: z.infer<typeof selection>;
    let provider: DeliveryProvider | undefined;
    try {
      chosen = selection.parse(JSON.parse(row.selection ?? "null"));
      provider = providers().get(chosen.providerCode);
    } catch {
      deferred += 1;
      continue;
    }
    if (!provider) {
      deferred += 1;
      continue;
    }
    const result = await bookOrderDelivery(
      { db: database, provider, configuredServiceType: chosen.providerServiceType, now: () => now },
      {
        requestId: `auto-book:${row.id}`,
        headers: {},
        locationId: row.location_id,
        jobId: row.id,
        expectedVersion: row.version,
        providerCode: chosen.providerCode,
        pickup: { kind: "IMMEDIATE" },
        idempotencyKey: `auto-book:${row.id}`,
      },
      null,
    );
    if (result.ok) submitted += 1;
    else deferred += 1;
  }
  return { attempted: rows.results.length, submitted, deferred, failed };
}
