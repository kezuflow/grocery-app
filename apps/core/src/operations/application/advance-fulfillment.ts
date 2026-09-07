import type { FulfillmentCommandRequest } from "@freshmarkets/contracts";
import type { AppErrorCode, OperationsCommandState } from "@freshmarkets/contracts";
import { fulfillmentTransitions, transitionToResult } from "../../commerce/state-machines";
import { claimCommandIdempotency, findIdempotencyRecord, requestHash } from "../../idempotency";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type AdvanceFulfillmentPorts = {
  /** Capability + location-scope authorization resolved by the caller. */
  authorize: (locationId: string) => Promise<boolean>;
};

export type AdvanceFulfillmentResult =
  | { ok: true; value: { id: string; status: OperationsCommandState }; requestId: string }
  | { ok: false; error: { code: AppErrorCode; message: string; requestId: string } };

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
      value: { id: command.orderId, status: row.status as OperationsCommandState },
      requestId: command.requestId,
    };
  if (priorCommand?.status === "PROCESSING")
    return failure(
      "CONFLICT",
      "The original fulfillment command is still processing",
      command.requestId,
    );
  const order = await database
    .prepare("SELECT status,version,fulfillment_mode FROM grocery_order WHERE id=?")
    .bind(command.orderId)
    .first<{ status: string; version: number; fulfillment_mode: "INSTANT" | "SCHEDULED" }>();
  if (
    !order ||
    ![
      "COMMITTED",
      "FULFILLMENT_PENDING",
      "FULFILLMENT_READY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ].includes(order.status)
  )
    return failure(
      "ILLEGAL_TRANSITION",
      "Order is not eligible for preparation",
      command.requestId,
    );
  if (command.action === "START_PICKING" && order.status !== "COMMITTED")
    return failure(
      "ILLEGAL_TRANSITION",
      "Order preparation has already started",
      command.requestId,
    );
  if (command.action === "MARK_PACKED" && order.status !== "FULFILLMENT_PENDING")
    return failure("ILLEGAL_TRANSITION", "Order is not being prepared", command.requestId);
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
        value: { id: command.orderId, status: next as OperationsCommandState },
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
    const statements: D1PreparedStatement[] = [
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -30 WHERE NOT EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status=? AND version=?)",
        )
        .bind(command.orderId, order.status, order.version),
      database
        .prepare(
          "UPDATE fulfillment_record SET status=?, updated_at=?, version=version+1 WHERE order_id=? AND version=? AND status=?",
        )
        .bind(next, now, command.orderId, command.expectedVersion, row.status),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -30 WHERE changes()!=1"),
    ];
    if (command.action === "START_PICKING" || command.action === "MARK_PACKED") {
      statements.push(
        database
          .prepare(
            "UPDATE grocery_order SET status=?,version=version+1 WHERE id=? AND status=? AND version=?",
          )
          .bind(
            command.action === "START_PICKING" ? "FULFILLMENT_PENDING" : "FULFILLMENT_READY",
            command.orderId,
            order.status,
            order.version,
          ),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -30 WHERE changes()!=1"),
      );
    }
    if (command.action === "MARK_PACKED" && order.fulfillment_mode === "INSTANT") {
      statements.push(
        database
          .prepare(`WITH expected AS (
            SELECT inventory_pool_id AS pool_id,SUM(reservation_delta_base) AS quantity
            FROM inventory_ledger_entries
            WHERE reference_type='grocery_order' AND reference_id=? AND reason_code='CHECKOUT_COMMIT'
            GROUP BY inventory_pool_id
          ), actual AS (
            SELECT inventory_pool_id AS pool_id,SUM(quantity) AS quantity
            FROM inventory_reservation WHERE order_id=? AND location_id=? AND status='RESERVED'
            GROUP BY inventory_pool_id
          ) INSERT INTO commitment_abort(id) SELECT -31 WHERE
            NOT EXISTS (SELECT 1 FROM expected)
            OR EXISTS (SELECT 1 FROM expected e LEFT JOIN actual a ON a.pool_id=e.pool_id
                       WHERE a.quantity IS NULL OR a.quantity!=e.quantity)
            OR EXISTS (SELECT 1 FROM actual a LEFT JOIN expected e ON e.pool_id=a.pool_id
                       WHERE e.pool_id IS NULL)
            OR EXISTS (SELECT 1 FROM inventory_reservation WHERE order_id=? AND status='RESERVED' AND location_id!=?)`)
          .bind(
            command.orderId,
            command.orderId,
            row.location_id,
            command.orderId,
            row.location_id,
          ),
        database
          .prepare(`INSERT INTO commitment_abort(id) SELECT -31 WHERE
          NOT EXISTS (SELECT 1 FROM inventory_reservation WHERE order_id=? AND status='RESERVED')
          OR EXISTS (SELECT 1 FROM inventory_reservation r LEFT JOIN inventory_balance b
                     ON b.location_id=r.location_id AND b.inventory_pool_id=r.inventory_pool_id
                     WHERE r.order_id=? AND r.status='RESERVED'
                     GROUP BY r.location_id,r.inventory_pool_id
                     HAVING b.reserved IS NULL OR b.reserved<SUM(r.quantity) OR b.on_hand<SUM(r.quantity))`)
          .bind(command.orderId, command.orderId),
        database
          .prepare(`INSERT INTO inventory_ledger_entries
          (id,inventory_pool_id,location_id,movement_type,quantity_delta_base,reservation_delta_base,
           reference_type,reference_id,actor_type,reason_code,metadata_json,created_at,idempotency_key)
          SELECT 'pack:'||id,inventory_pool_id,location_id,'FULFILLMENT_CONSUMED',-quantity,-quantity,
                 'grocery_order',order_id,'SYSTEM','ORDER_PACKED','{}',?,'pack:'||id
          FROM inventory_reservation WHERE order_id=? AND status='RESERVED'`)
          .bind(now, command.orderId),
        database
          .prepare(`UPDATE inventory_balance SET
          on_hand=on_hand-(SELECT SUM(quantity) FROM inventory_reservation r WHERE r.order_id=? AND r.status='RESERVED' AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id),
          reserved=reserved-(SELECT SUM(quantity) FROM inventory_reservation r WHERE r.order_id=? AND r.status='RESERVED' AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id),version=version+1
          WHERE EXISTS (SELECT 1 FROM inventory_reservation r WHERE r.order_id=? AND r.status='RESERVED' AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id)`)
          .bind(command.orderId, command.orderId, command.orderId),
        database
          .prepare(
            "UPDATE inventory_reservation SET status='CONSUMED',version=version+1 WHERE order_id=? AND status='RESERVED'",
          )
          .bind(command.orderId),
      );
    }
    statements.push(
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(command.orderId, now, SCOPE, command.idempotencyKey, idempotency.hash),
    );
    await database.batch(statements);
  } catch (error) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey)
      .run();
    if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed"))
      throw error;
    return failure(
      "STALE_VERSION",
      "Fulfillment changed; refresh before retrying",
      command.requestId,
    );
  }
  return {
    ok: true as const,
    value: { id: command.orderId, status: next as OperationsCommandState },
    requestId: command.requestId,
  };
}
