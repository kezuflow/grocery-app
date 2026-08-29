import type { DeliveryCommandRequest } from "@freshmarkets/contracts";
import { deliveryJobTransitions, transitionToResult } from "../../commerce/state-machines";
import { claimCommandIdempotency, findIdempotencyRecord, requestHash } from "../../idempotency";
import { activeFulfillmentLocationId, activeMarketCode } from "../../geography/market-defaults";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type AdvanceDeliveryPorts = {
  /**
   * Capability + location-scope authorization for this specific job,
   * including the assigned-rider restriction resolved by the caller.
   */
  authorize: (job: { locationId: string; riderAuthUserId: string | null }) => Promise<boolean>;
};

export type AdvanceDeliveryResult =
  | { ok: true; value: { id: string; status: string }; requestId: string }
  | { ok: false; error: { code: string; message: string; requestId: string } };

const SCOPE = "delivery.advance";

const ACTION_TARGET = {
  MARK_EN_ROUTE: "EN_ROUTE",
  MARK_ARRIVED: "ARRIVED",
  MARK_DELIVERED: "DELIVERED",
  MARK_FAILED: "FAILED",
  SCHEDULE_RETRY: "RETRY_SCHEDULED",
  ESCALATE: "ESCALATED",
  CANCEL: "CANCELED",
} as const;

/**
 * Advance the delivery job through its guarded canonical machine. DELIVERED also moves the order to
 * DELIVERED in the same batch and requires that order row to exist;
 * authorization resolves against the fulfillment record's location with the
 * market default as fallback.
 */
export async function advanceDelivery(
  database: D1Database,
  command: DeliveryCommandRequest,
  ports: AdvanceDeliveryPorts,
): Promise<AdvanceDeliveryResult> {
  const row = await database
    .prepare(
      "SELECT d.status, d.version, d.rider_user_id, f.location_id FROM delivery_job d LEFT JOIN fulfillment_record f ON f.order_id=d.order_id WHERE d.order_id=?",
    )
    .bind(command.orderId)
    .first<{
      status: string;
      version: number;
      rider_user_id: string | null;
      location_id: string | null;
    }>();
  if (!row) return failure("NOT_FOUND", "Delivery job not found", command.requestId);
  const deliveryLocationId =
    row.location_id ??
    (await activeFulfillmentLocationId(database, await activeMarketCode(database)));
  if (!deliveryLocationId)
    return failure(
      "CONFIGURATION_ERROR",
      "No active fulfillment location is configured",
      command.requestId,
    );
  if (
    !(await ports.authorize({ locationId: deliveryLocationId, riderAuthUserId: row.rider_user_id }))
  )
    return failure(
      "FORBIDDEN",
      "Delivery capability and location scope are required",
      command.requestId,
    );
  const payload = {
    orderId: command.orderId,
    action: command.action,
    expectedVersion: command.expectedVersion,
  };
  const hash = await requestHash(payload);
  const priorCommand = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
  if (priorCommand?.requestHash !== undefined && priorCommand.requestHash !== hash)
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was used with a different request",
      command.requestId,
    );
  if (priorCommand?.status === "SUCCEEDED")
    return {
      ok: true,
      value: { id: command.orderId, status: row.status },
      requestId: command.requestId,
    };
  if (priorCommand?.status === "PROCESSING")
    return failure(
      "CONFLICT",
      "The original delivery command is still processing",
      command.requestId,
    );
  const transitionResult = transitionToResult(
    row.status,
    ACTION_TARGET[command.action],
    deliveryJobTransitions,
    command.requestId,
  );
  if (!transitionResult.ok) return transitionResult;
  const next = transitionResult.value;
  const idempotency = await claimCommandIdempotency(
    database,
    Date.now,
    SCOPE,
    command.idempotencyKey,
    payload,
  );
  if (!idempotency.claimed) {
    if (!idempotency.existing)
      return failure(
        "CONFLICT",
        "The original delivery command is still processing",
        command.requestId,
      );
    if (idempotency.existing.requestHash !== idempotency.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (idempotency.existing.status === "SUCCEEDED")
      return {
        ok: true as const,
        value: { id: command.orderId, status: next },
        requestId: command.requestId,
      };
    return failure(
      "CONFLICT",
      "The original delivery command is still processing",
      command.requestId,
    );
  }
  const now = Date.now();
  const deliveryUpdate = database
    .prepare(
      "UPDATE delivery_job SET status=?, delivered_at=?, updated_at=?, version=version+1 WHERE order_id=? AND version=?",
    )
    .bind(next, next === "DELIVERED" ? now : null, now, command.orderId, command.expectedVersion);
  const statements = [
    deliveryUpdate,
    database
      .prepare(
        "INSERT INTO admin_command_abort(id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM delivery_job WHERE order_id=? AND status=? AND version=?)",
      )
      .bind(command.orderId, next, command.expectedVersion + 1),
  ];
  if (next === "DELIVERED")
    statements.push(
      database
        .prepare("UPDATE grocery_order SET status='DELIVERED' WHERE id=?")
        .bind(command.orderId),
      database
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status='DELIVERED')",
        )
        .bind(command.orderId),
    );
  statements.push(
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(command.orderId, now, SCOPE, command.idempotencyKey, idempotency.hash),
  );
  try {
    await database.batch(statements);
  } catch {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey)
      .run();
    return failure("STALE_VERSION", "Delivery changed; refresh before retrying", command.requestId);
  }
  return {
    ok: true as const,
    value: { id: command.orderId, status: next },
    requestId: command.requestId,
  };
}
