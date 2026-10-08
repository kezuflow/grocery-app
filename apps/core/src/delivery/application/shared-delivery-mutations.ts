import type {
  AppErrorCode,
  ExternalDeliveryDispatchView,
  ExternalDeliveryMutationRequest,
  RefreshExternalDeliveryRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import type { OperationsAdministrationDeps } from "../../admin/application/operations-administration-access";
import { resolveOperationsAdministrationAccess } from "../../admin/application/operations-administration-access";
import { requestHash } from "../../idempotency";
import type { DeliveryProvider } from "../ports/delivery-provider";
import type { ProviderEvent } from "../ports/provider-event";
import { loadSharedBooking, sharedAccessGuard, sharedConflict } from "./shared-delivery-booking";
import { applySharedDeliveryEvent } from "./apply-shared-delivery-event";

function failure(code: AppErrorCode, message: string, requestId: string): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}
export async function sharedDispatchView(
  db: D1Database,
  dispatchId: string,
): Promise<ExternalDeliveryDispatchView | null> {
  const row = await db
    .prepare(`SELECT d.id AS dispatchId,d.delivery_job_id AS deliveryJobId,d.provider,d.status,d.provider_status AS providerStatus,
    b.provider_delivery_id AS providerDeliveryId,b.tracking_url AS trackingUrl,b.version,b.last_error_code AS lastErrorCode,
    b.id AS bookingId,b.quote_amount_minor AS quoteAmount,b.final_payable_minor AS actualCost,
    (SELECT COUNT(*) FROM delivery_shared_booking_member WHERE booking_id=b.id) AS memberCount
    FROM delivery_provider_dispatch d JOIN delivery_shared_booking b ON b.id=d.shared_booking_id WHERE d.id=?`)
    .bind(dispatchId)
    .first<{
      dispatchId: string;
      deliveryJobId: string;
      provider: "lalamove";
      status: string;
      providerStatus: string | null;
      providerDeliveryId: string | null;
      trackingUrl: string | null;
      version: number;
      lastErrorCode: string | null;
      bookingId: string;
      quoteAmount: number;
      actualCost: number | null;
      memberCount: number;
    }>();
  return row
    ? {
        dispatchId: row.dispatchId,
        deliveryJobId: row.deliveryJobId,
        provider: "lalamove",
        providerDeliveryId: row.providerDeliveryId,
        status: row.status,
        providerStatus: row.providerStatus,
        trackingUrl: row.trackingUrl,
        pickupPin: null,
        quoteAmountMinor: null,
        quoteCurrency: null,
        attemptCount: 1,
        lastErrorCode: row.lastErrorCode,
        version: row.version,
        sharedBooking: {
          bookingId: row.bookingId,
          memberCount: row.memberCount,
          quoteAmountMinor: row.quoteAmount,
          actualCostMinor: row.actualCost,
          currency: "PHP",
        },
      }
    : null;
}

export async function mutateSharedDelivery(
  deps: OperationsAdministrationDeps & { provider: DeliveryProvider; now: () => number },
  input: RefreshExternalDeliveryRequest | ExternalDeliveryMutationRequest,
  operation: "REFRESH" | "CANCEL",
): Promise<RpcResult<ExternalDeliveryDispatchView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    input,
    "delivery.manage",
    input.locationId,
  );
  if (!access.ok) return access;
  const member = await deps.db
    .prepare(
      `SELECT d.shared_booking_id FROM delivery_provider_dispatch d JOIN delivery_job job ON job.id=d.delivery_job_id WHERE d.id=? AND job.location_id=?`,
    )
    .bind(input.dispatchId, input.locationId)
    .first<{ shared_booking_id: string | null }>();
  if (!member?.shared_booking_id)
    return failure("NOT_FOUND", "Shared courier booking not found", input.requestId);
  const row = await loadSharedBooking(deps.db, member.shared_booking_id, input.locationId);
  if (!row) return failure("NOT_FOUND", "Shared courier booking not found", input.requestId);
  const candidate = "providerDeliveryId" in input ? input.providerDeliveryId : undefined;
  const hash = await requestHash({
    operation,
    locationId: input.locationId,
    dispatchId: input.dispatchId,
    expectedVersion: input.expectedVersion,
    providerDeliveryId: candidate ?? null,
  });
  const prior = await deps.db
    .prepare(
      "SELECT id,request_hash,status,result_json,updated_at FROM delivery_shared_booking_command WHERE operation=? AND idempotency_key=?",
    )
    .bind(operation, input.idempotencyKey)
    .first<{
      id: string;
      request_hash: string;
      status: string;
      result_json: string | null;
      updated_at: number;
    }>();
  if (prior) {
    if (prior.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This request key belongs to another courier operation",
        input.requestId,
      );
    if (prior.status === "SUCCEEDED" && prior.result_json)
      return {
        ok: true,
        value: JSON.parse(prior.result_json) as ExternalDeliveryDispatchView,
        requestId: input.requestId,
      };
    if (operation === "CANCEL" || prior.updated_at > deps.now() - 300000)
      return failure(
        "CONFLICT",
        "This provider operation is already submitted. Use Refresh provider to check its outcome.",
        input.requestId,
      );
  }
  if (row.version !== input.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Shared booking changed; refresh the Delivery page",
      input.requestId,
    );
  const providerId = row.provider_delivery_id ?? candidate;
  if (candidate && row.provider_delivery_id && candidate !== row.provider_delivery_id)
    return failure(
      "VALIDATION_FAILED",
      "That provider identity differs from the saved shared booking",
      input.requestId,
    );
  if (!providerId)
    return failure(
      "VALIDATION_FAILED",
      "Enter the Sandbox/production order number for this uncertain shared booking",
      input.requestId,
    );
  if (operation === "CANCEL" && (row.status !== "ACTIVE" || row.cancel_pending))
    return failure(
      "ILLEGAL_TRANSITION",
      "The shared booking cannot be canceled in its current state",
      input.requestId,
    );
  const commandId = prior?.id ?? crypto.randomUUID();
  const now = deps.now();
  try {
    await deps.db.batch([
      sharedAccessGuard(deps.db, access.value.authUserId, input.locationId),
      deps.db
        .prepare(
          `UPDATE delivery_shared_booking SET version=version+1,updated_at=?,cancel_pending=CASE WHEN ?='CANCEL' THEN 1 ELSE cancel_pending END,status=CASE WHEN ?='CANCEL' THEN 'OUTCOME_UNKNOWN' ELSE status END WHERE id=? AND version=?`,
        )
        .bind(now, operation, operation, row.id, input.expectedVersion),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      ...(operation === "CANCEL"
        ? [
            deps.db
              .prepare(
                "UPDATE delivery_provider_dispatch SET status='OUTCOME_UNKNOWN',version=version+1,updated_at=? WHERE shared_booking_id=? AND status='ACTIVE'",
              )
              .bind(now, row.id),
          ]
        : []),
      deps.db
        .prepare(`INSERT INTO delivery_shared_booking_command(id,booking_id,dispatch_id,operation,idempotency_key,request_hash,actor_user_id,location_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'SUBMITTING',?,?) ON CONFLICT(operation,idempotency_key) DO UPDATE SET status='SUBMITTING',updated_at=excluded.updated_at
        WHERE delivery_shared_booking_command.request_hash=excluded.request_hash AND delivery_shared_booking_command.operation='REFRESH' AND delivery_shared_booking_command.updated_at<?`)
        .bind(
          commandId,
          row.id,
          input.dispatchId,
          operation,
          input.idempotencyKey,
          hash,
          access.value.authUserId,
          input.locationId,
          now,
          now,
          now - 300000,
        ),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      deps.db
        .prepare(`INSERT OR IGNORE INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,correlation_id,occurred_at)
        VALUES (?,?,'DELIVERY.SHARED_PROVIDER_OPERATION','delivery_shared_booking',?,?,?,?,?,?)`)
        .bind(
          `shared-operation:${commandId}`,
          access.value.authUserId,
          row.id,
          JSON.stringify({ operation }),
          input.idempotencyKey,
          input.locationId,
          input.requestId,
          now,
        ),
    ]);
  } catch (error) {
    if (!sharedConflict(error)) throw error;
    return failure(
      "STALE_VERSION",
      "The shared booking or access changed before the provider operation",
      input.requestId,
    );
  }
  if (operation === "CANCEL") {
    const canceled = await deps.provider.cancel(providerId);
    if (!canceled.ok) {
      await deps.db.batch([
        deps.db
          .prepare(
            "UPDATE delivery_shared_booking_command SET status=?,updated_at=? WHERE id=? AND status='SUBMITTING'",
          )
          .bind(
            canceled.error.outcomeUnknown ? "OUTCOME_UNKNOWN" : "REJECTED",
            deps.now(),
            commandId,
          ),
        ...(!canceled.error.outcomeUnknown
          ? [
              deps.db
                .prepare(
                  "UPDATE delivery_shared_booking SET cancel_pending=0,status='ACTIVE',version=version+1,updated_at=? WHERE id=? AND version=? AND cancel_pending=1 AND status='OUTCOME_UNKNOWN'",
                )
                .bind(deps.now(), row.id, row.version + 1),
              deps.db
                .prepare(
                  "UPDATE delivery_provider_dispatch SET status='ACTIVE',version=version+1 WHERE shared_booking_id=? AND status='OUTCOME_UNKNOWN' AND EXISTS(SELECT 1 FROM delivery_shared_booking b WHERE b.id=? AND b.cancel_pending=0 AND b.status='ACTIVE')",
                )
                .bind(row.id, row.id),
            ]
          : []),
      ]);
      return failure(
        "CONFLICT",
        canceled.error.outcomeUnknown
          ? "Cancellation may have reached Lalamove. Refresh provider confirmation before changing these orders."
          : "Lalamove rejected cancellation. The orders retain their current courier.",
        input.requestId,
      );
    }
  }
  const observed = await deps.provider.get(providerId);
  if (!observed.ok || !observed.value || observed.value.providerDeliveryId !== providerId) {
    await deps.db
      .prepare(
        "UPDATE delivery_shared_booking_command SET status=?,updated_at=? WHERE id=? AND status='SUBMITTING'",
      )
      .bind(operation === "CANCEL" ? "OUTCOME_UNKNOWN" : "REJECTED", deps.now(), commandId)
      .run();
    return failure(
      "CONFLICT",
      "Provider confirmation is unavailable. The saved booking is preserved.",
      input.requestId,
    );
  }
  if (
    (row.provider_delivery_id === null &&
      observed.value.merchantOrderId !== row.merchant_order_id) ||
    (observed.value.merchantOrderId !== null &&
      observed.value.merchantOrderId !== row.merchant_order_id)
  ) {
    await deps.db
      .prepare(
        "UPDATE delivery_shared_booking_command SET status='REJECTED',updated_at=? WHERE id=?",
      )
      .bind(deps.now(), commandId)
      .run();
    return failure(
      "CONFLICT",
      "That provider order does not belong to this shared booking",
      input.requestId,
    );
  }
  const event: ProviderEvent = {
    eventId: `shared-operation-observation:${commandId}`,
    kind: "STATUS",
    providerDeliveryId: providerId,
    merchantOrderId: row.merchant_order_id,
    observedAt: deps.now(),
    status: observed.value.status,
    driverId: observed.value.driverId,
    trackingUrl: observed.value.trackingUrl,
    evidence: observed.value.evidence,
    observedStops: observed.value.observedStops,
    replacementCheck: observed.value.replacementCheck,
  };
  await deps.db
    .prepare(`INSERT OR IGNORE INTO delivery_provider_event_inbox(id,provider,provider_event_id,shared_booking_id,provider_delivery_id,merchant_order_id,observed_at,provider_status,payload_hash,raw_payload,normalized_event_json,processing_status,received_at)
    VALUES (?,'lalamove',?,?,?,?,?,?,?,?,?,'RECEIVED',?)`)
    .bind(
      event.eventId,
      event.eventId,
      row.id,
      providerId,
      row.merchant_order_id,
      event.observedAt,
      event.status,
      await requestHash(event),
      JSON.stringify(observed.value),
      JSON.stringify(event),
      deps.now(),
    )
    .run();
  const applied = await applySharedDeliveryEvent(deps.db, row.id, event, event.eventId);
  if (applied.outcome === "RECONCILIATION_REQUIRED")
    return failure(
      "CONFLICT",
      "Provider evidence is saved and needs reconciliation. Do not rebook these orders.",
      input.requestId,
    );
  const value = await sharedDispatchView(deps.db, input.dispatchId);
  if (!value) return failure("NOT_FOUND", "The delivery attempt is unavailable", input.requestId);
  if (operation === "CANCEL") {
    const receipt = await deps.db
      .prepare("SELECT status,result_json FROM delivery_shared_booking_command WHERE id=?")
      .bind(commandId)
      .first<{ status: string; result_json: string | null }>();
    if (receipt?.status !== "SUCCEEDED" || !receipt.result_json)
      return failure(
        "CONFLICT",
        "Cancellation is submitted; wait for provider confirmation",
        input.requestId,
      );
    return {
      ok: true,
      value: JSON.parse(receipt.result_json) as ExternalDeliveryDispatchView,
      requestId: input.requestId,
    };
  }
  await deps.db.batch([
    deps.db
      .prepare(
        "UPDATE delivery_shared_booking_command SET status='SUCCEEDED',result_json=?,updated_at=? WHERE id=? AND status='SUBMITTING'",
      )
      .bind(JSON.stringify(value), deps.now(), commandId),
    deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
  ]);
  return { ok: true, value, requestId: input.requestId };
}
