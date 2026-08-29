import type { FulfillmentCommandRequest } from "@freshmarkets/contracts";
import { fulfillmentTransitions, transitionToResult } from "../../commerce/state-machines";
import { claimCommandIdempotency, findIdempotencyRecord, requestHash } from "../../idempotency";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type AdvanceFulfillmentPorts = {
  /** Capability + location-scope authorization resolved by the caller. */
  authorize: (locationId: string) => Promise<boolean>;
};

export type AdvanceFulfillmentResult =
  | { ok: true; value: { id: string; status: string }; requestId: string }
  | { ok: false; error: { code: string; message: string; requestId: string } };

const SCOPE = "fulfillment.advance";

const ACTION_TARGET = {
  START_PICKING: "PICKING",
  MARK_READY_TO_PACK: "READY_TO_PACK",
  START_PACKING: "PACKING",
  MARK_PACKED: "PACKED",
  HAND_OFF: "HANDED_OFF",
  COMPLETE: "COMPLETED",
  RECORD_SHORTAGE: "SHORTED",
  RESUME_PICKING: "PICKING",
  RESUME_READY_TO_PACK: "READY_TO_PACK",
  CANCEL: "CANCELED",
  ESCALATE: "ESCALATED",
} as const;

/**
 * Advance the fulfillment record through its guarded machine
 * through the canonical picking/packing/hand-off lifecycle with a conditional version update.
 * The location is discovered from the record before authorization; an
 * idempotency claim wraps the mutation and is marked FAILED on a stale
 * version so the key can be reclaimed after refresh.
 */
export async function advanceFulfillment(
  database: D1Database,
  command: FulfillmentCommandRequest,
  ports: AdvanceFulfillmentPorts,
): Promise<AdvanceFulfillmentResult> {
  const row = await database
    .prepare("SELECT status, location_id, version FROM fulfillment_record WHERE order_id=?")
    .bind(command.orderId)
    .first<{ status: string; location_id: string; version: number }>();
  if (!row) return failure("NOT_FOUND", "Fulfillment record not found", command.requestId);
  if (!(await ports.authorize(row.location_id)))
    return failure(
      "FORBIDDEN",
      "Fulfillment capability and location scope are required",
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
      "The original fulfillment command is still processing",
      command.requestId,
    );
  const transitionResult = transitionToResult(
    row.status,
    ACTION_TARGET[command.action],
    fulfillmentTransitions,
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
        "The original fulfillment command is still processing",
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
      "The original fulfillment command is still processing",
      command.requestId,
    );
  }
  try {
    const now = Date.now();
    await database.batch([
      database
        .prepare(
          "UPDATE fulfillment_record SET status=?, updated_at=?, version=version+1 WHERE order_id=? AND version=?",
        )
        .bind(next, now, command.orderId, command.expectedVersion),
      database
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM fulfillment_record WHERE order_id=? AND status=? AND version=?)",
        )
        .bind(command.orderId, next, command.expectedVersion + 1),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(command.orderId, now, SCOPE, command.idempotencyKey, idempotency.hash),
    ]);
  } catch {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey)
      .run();
    return failure(
      "STALE_VERSION",
      "Fulfillment changed; refresh before retrying",
      command.requestId,
    );
  }
  return {
    ok: true as const,
    value: { id: command.orderId, status: next },
    requestId: command.requestId,
  };
}
