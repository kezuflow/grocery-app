import type { DeliveryCommandRequest } from "@freshmarkets/contracts";
import { deliveryTransitions, transitionToResult } from "../../commerce/state-machines";
import { claimCommandIdempotency } from "../../idempotency";
import { activeFulfillmentLocationId, activeMarketCode } from "../../geography/market-defaults";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type AdvanceDeliveryPorts = {
  /** Capability + location-scope authorization resolved by the caller. */
  authorize: (locationId: string) => Promise<boolean>;
};

export type AdvanceDeliveryResult =
  | { ok: true; value: { id: string; status: string }; requestId: string }
  | { ok: false; error: { code: string; message: string; requestId: string } };

const SCOPE = "delivery.advance";

/**
 * Advance the delivery job through its guarded machine (DISPATCH/DELIVER/
 * FAIL) with a conditional version update. DELIVERED also moves the order to
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
      "SELECT d.status, d.version, f.location_id FROM delivery_job d LEFT JOIN fulfillment_record f ON f.order_id=d.order_id WHERE d.order_id=?",
    )
    .bind(command.orderId)
    .first<{ status: string; version: number; location_id: string | null }>();
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
  if (!(await ports.authorize(deliveryLocationId)))
    return failure(
      "FORBIDDEN",
      "Delivery capability and location scope are required",
      command.requestId,
    );
  const transitionResult = transitionToResult(
    row.status,
    command.action === "DISPATCH"
      ? "DISPATCHED"
      : command.action === "DELIVER"
        ? "DELIVERED"
        : "FAILED",
    deliveryTransitions,
    command.requestId,
  );
  if (!transitionResult.ok) return transitionResult;
  const next = transitionResult.value;
  const idempotency = await claimCommandIdempotency(
    database,
    Date.now,
    SCOPE,
    command.idempotencyKey,
    {
      orderId: command.orderId,
      action: command.action,
      expectedVersion: command.expectedVersion,
    },
  );
  if (idempotency.existing) {
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
  const deliveryUpdate = database
    .prepare(
      "UPDATE delivery_job SET status=?, delivered_at=?, version=version+1 WHERE order_id=? AND version=?",
    )
    .bind(next, next === "DELIVERED" ? Date.now() : null, command.orderId, command.expectedVersion);
  const statements = [deliveryUpdate];
  if (next === "DELIVERED")
    statements.push(
      database
        .prepare("UPDATE grocery_order SET status='DELIVERED' WHERE id=?")
        .bind(command.orderId),
    );
  const results = await database.batch(statements);
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey)
      .run();
    return failure("STALE_VERSION", "Delivery changed; refresh before retrying", command.requestId);
  }
  if (next === "DELIVERED" && (results[1]?.meta?.changes ?? 0) !== 1)
    return failure("NOT_FOUND", "Order not found while completing delivery", command.requestId);
  await database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
    .bind(command.orderId, Date.now(), SCOPE, command.idempotencyKey, idempotency.hash)
    .run();
  return {
    ok: true as const,
    value: { id: command.orderId, status: next },
    requestId: command.requestId,
  };
}
