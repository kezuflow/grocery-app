import type { CreateDeliveryRequest, DeliveryProvider } from "../ports/delivery-provider";

type DispatchStatus =
  | "PENDING"
  | "CREATING"
  | "RETRY_REQUIRED"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELED"
  | "RETURNED"
  | "FAILED"
  | "OUTCOME_UNKNOWN"
  | "RECONCILIATION_REQUIRED";

type DispatchRow = {
  id: string;
  delivery_job_id: string;
  provider: string;
  merchant_order_id: string;
  provider_delivery_id: string | null;
  request_hash: string;
  status: DispatchStatus;
  provider_status: string | null;
  tracking_url: string | null;
  pickup_pin: string | null;
  quote_amount_minor: number | null;
  quote_currency: string | null;
  attempt_count: number;
  last_error_code: string | null;
  version: number;
};

export type ProviderDispatchView = Readonly<{
  dispatchId: string;
  deliveryJobId: string;
  provider: string;
  merchantOrderId: string;
  providerDeliveryId: string | null;
  status: DispatchStatus;
  providerStatus: string | null;
  trackingUrl: string | null;
  pickupPin: string | null;
  quoteAmountMinor: number | null;
  quoteCurrency: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  version: number;
}>;

export type RequestProviderDeliveryResult =
  | Readonly<{ ok: true; value: ProviderDispatchView; requestId: string }>
  | Readonly<{
      ok: false;
      error: { code: string; message: string; requestId: string };
    }>;

const COLUMNS =
  "id, delivery_job_id, provider, merchant_order_id, provider_delivery_id, request_hash, status, provider_status, tracking_url, pickup_pin, quote_amount_minor, quote_currency, attempt_count, last_error_code, version";

function failure(code: string, message: string, requestId: string): RequestProviderDeliveryResult {
  return { ok: false, error: { code, message, requestId } };
}

function view(row: DispatchRow): ProviderDispatchView {
  return {
    dispatchId: row.id,
    deliveryJobId: row.delivery_job_id,
    provider: row.provider,
    merchantOrderId: row.merchant_order_id,
    providerDeliveryId: row.provider_delivery_id,
    status: row.status,
    providerStatus: row.provider_status,
    trackingUrl: row.tracking_url,
    pickupPin: row.pickup_pin,
    quoteAmountMinor: row.quote_amount_minor,
    quoteCurrency: row.quote_currency,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
    version: row.version,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readDispatch(database: D1Database, id: string): Promise<DispatchRow | null> {
  return database
    .prepare(`SELECT ${COLUMNS} FROM delivery_provider_dispatch WHERE id=? AND method='EXTERNAL'`)
    .bind(id)
    .first<DispatchRow>();
}

/**
 * Starts one provider booking from a prebuilt immutable dispatch snapshot.
 * The caller must derive that snapshot from the committed Order, packed parcel,
 * fulfillment-location sender profile, and DeliveryStop destination.
 */
export async function requestProviderDelivery(
  database: D1Database,
  provider: DeliveryProvider,
  command: Readonly<{
    requestId: string;
    deliveryJobId: string;
    /** Optional atomic eligibility claim used by operator dispatch commands. */
    expectedDeliveryJobVersion?: number;
    clientIdempotencyKey?: string;
    request: CreateDeliveryRequest;
  }>,
): Promise<RequestProviderDeliveryResult> {
  const requestSnapshot = JSON.stringify(command.request);
  const requestHash = await sha256(requestSnapshot);
  const attemptIdentity = await sha256(
    JSON.stringify([
      command.deliveryJobId,
      command.clientIdempotencyKey ?? command.request.merchantOrderId,
    ]),
  );
  const dispatchId = `dispatch:${provider.code}:${attemptIdentity}`;
  const now = Date.now();

  await database
    .prepare(
      `INSERT OR IGNORE INTO delivery_provider_dispatch
       (id, delivery_job_id, provider, merchant_order_id, request_hash,
        request_snapshot_json, status, attempt_count, version, created_at, updated_at,
        client_idempotency_key,attempt_sequence)
       SELECT ?, ?, ?, ?, ?, ?, 'PENDING', 0, 1, ?, ?, ?,
         (SELECT COALESCE(MAX(previous.attempt_sequence),0)+1 FROM delivery_provider_dispatch previous WHERE previous.delivery_job_id=job.id)
       FROM delivery_job job
       WHERE job.id=? AND NOT EXISTS (
         SELECT 1 FROM delivery_provider_command pending
         JOIN delivery_provider_dispatch previous ON previous.id=pending.dispatch_id
         WHERE previous.delivery_job_id=job.id AND pending.operation='CANCEL'
           AND pending.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED')
       ) AND (
         ? IS NULL OR (
           job.version=? AND job.status IN ('UNASSIGNED','RETRY_SCHEDULED')
           AND job.batch_id IS NULL AND job.rider_id IS NULL
         )
       )`,
    )
    .bind(
      dispatchId,
      command.deliveryJobId,
      provider.code,
      command.request.merchantOrderId,
      requestHash,
      requestSnapshot,
      now,
      now,
      command.clientIdempotencyKey ?? null,
      command.deliveryJobId,
      command.expectedDeliveryJobVersion ?? null,
      command.expectedDeliveryJobVersion ?? null,
    )
    .run();

  const current = await readDispatch(database, dispatchId);
  if (!current)
    return failure(
      "DELIVERY_DISPATCH_UNAVAILABLE",
      "Delivery dispatch is unavailable",
      command.requestId,
    );
  if (current.request_hash !== requestHash)
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "The delivery job already has a different provider request",
      command.requestId,
    );
  if (
    current.status === "ACTIVE" ||
    current.status === "COMPLETED" ||
    current.status === "CANCELED" ||
    current.status === "RETURNED"
  )
    return { ok: true, value: view(current), requestId: command.requestId };
  if (current.status === "CREATING" || current.status === "OUTCOME_UNKNOWN")
    return failure(
      "DELIVERY_RECONCILIATION_REQUIRED",
      "The provider booking outcome must be reconciled before another attempt",
      command.requestId,
    );
  if (current.status === "FAILED" || current.status === "RECONCILIATION_REQUIRED")
    return failure(
      "DELIVERY_DISPATCH_BLOCKED",
      "The provider booking requires operational review",
      command.requestId,
    );

  const claimed = await database
    .prepare(
      `UPDATE delivery_provider_dispatch
       SET status='CREATING', attempt_count=attempt_count+1,
           last_error_code=NULL, version=version+1, updated_at=?
       WHERE id=? AND version=? AND status IN ('PENDING', 'RETRY_REQUIRED')`,
    )
    .bind(now, dispatchId, current.version)
    .run();
  if ((claimed.meta?.changes ?? 0) !== 1)
    return failure(
      "DELIVERY_DISPATCH_BUSY",
      "Another request is handling this provider booking",
      command.requestId,
    );

  const created = await provider.create(command.request);
  const claimedRow = await readDispatch(database, dispatchId);
  if (!claimedRow)
    return failure(
      "DELIVERY_DISPATCH_UNAVAILABLE",
      "Delivery dispatch is unavailable",
      command.requestId,
    );

  if (!created.ok) {
    const nextStatus: DispatchStatus = created.error.outcomeUnknown
      ? "OUTCOME_UNKNOWN"
      : created.error.retryable
        ? "RETRY_REQUIRED"
        : "FAILED";
    await database
      .prepare(
        `UPDATE delivery_provider_dispatch
         SET status=?, last_error_code=?, version=version+1, updated_at=?
         WHERE id=? AND version=? AND status='CREATING'`,
      )
      .bind(nextStatus, created.error.code, Date.now(), dispatchId, claimedRow.version)
      .run();
    return failure(
      created.error.outcomeUnknown ? "DELIVERY_RECONCILIATION_REQUIRED" : created.error.code,
      created.error.outcomeUnknown
        ? "The provider may have accepted the booking; reconciliation is required"
        : "The provider booking was not created",
      command.requestId,
    );
  }

  const saved = await database
    .prepare(
      `UPDATE delivery_provider_dispatch
       SET provider_delivery_id=?, status='ACTIVE', provider_status=?,
           tracking_url=?, pickup_pin=?, quote_amount_minor=?, quote_currency=?,
           last_error_code=NULL, version=version+1, updated_at=?
       WHERE id=? AND version=? AND status='CREATING'`,
    )
    .bind(
      created.value.providerDeliveryId,
      created.value.status,
      created.value.trackingUrl,
      created.value.pickupPin,
      created.value.quote?.amountMinor ?? null,
      created.value.quote?.currency ?? null,
      Date.now(),
      dispatchId,
      claimedRow.version,
    )
    .run();
  if ((saved.meta?.changes ?? 0) !== 1)
    return failure(
      "DELIVERY_RECONCILIATION_REQUIRED",
      "The provider accepted the booking but its local record needs reconciliation",
      command.requestId,
    );

  if (command.expectedDeliveryJobVersion !== undefined) {
    const assigned = await database
      .prepare(
        `UPDATE delivery_job SET status='ASSIGNED',version=version+1,updated_at=?
         WHERE id=? AND version=? AND status IN ('UNASSIGNED','RETRY_SCHEDULED')
           AND batch_id IS NULL AND rider_id IS NULL`,
      )
      .bind(Date.now(), command.deliveryJobId, command.expectedDeliveryJobVersion)
      .run();
    if ((assigned.meta?.changes ?? 0) !== 1) {
      await database
        .prepare(
          `UPDATE delivery_provider_dispatch
           SET status='RECONCILIATION_REQUIRED',last_error_code='LOCAL_JOB_CLAIM_FAILED',
               version=version+1,updated_at=? WHERE id=? AND status='ACTIVE'`,
        )
        .bind(Date.now(), dispatchId)
        .run();
      return failure(
        "DELIVERY_RECONCILIATION_REQUIRED",
        "The provider accepted the booking but the delivery job claim needs reconciliation",
        command.requestId,
      );
    }
  }

  const completed = await readDispatch(database, dispatchId);
  return completed
    ? { ok: true, value: view(completed), requestId: command.requestId }
    : failure(
        "DELIVERY_DISPATCH_UNAVAILABLE",
        "Delivery dispatch is unavailable",
        command.requestId,
      );
}
