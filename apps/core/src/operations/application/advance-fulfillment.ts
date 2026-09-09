import type { FulfillmentCommandRequest } from "@freshmarkets/contracts";
import type { AppErrorCode } from "@freshmarkets/contracts";
import { fulfillmentTransitions, transitionToResult } from "../../commerce/state-machines";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { fulfillmentStates } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { consumeCycleGoodsStatements } from "../../fulfillment/application/consume-cycle-goods";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type AdvanceFulfillmentPorts = {
  /** Capability + location-scope authorization resolved by the caller. */
  authorize: (locationId: string) => Promise<boolean>;
  /** Trusted authenticated actor supplied by both reachable RPC adapters. */
  actorAuthUserId?: string;
  reason?: string;
};

const resultSchema = z.object({
  id: z.string(),
  status: z.enum(fulfillmentStates),
  version: z.number().int().positive(),
  locationId: z.string(),
  cycleId: z.string().nullable(),
});
export type AdvanceFulfillmentResult =
  | { ok: true; value: z.infer<typeof resultSchema>; requestId: string }
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
 * The location is discovered from the record before authorization. The
 * claim, mutation, audit and original result share one guarded transaction.
 * A rejection leaves no new claim or business effects.
 */
export async function advanceFulfillment(
  database: D1Database,
  command: FulfillmentCommandRequest,
  ports: AdvanceFulfillmentPorts,
): Promise<AdvanceFulfillmentResult> {
  const row = await database
    .prepare(
      "SELECT f.status,f.location_id,f.version,o.cycle_id FROM fulfillment_record f LEFT JOIN grocery_order o ON o.id=f.order_id WHERE f.order_id=?",
    )
    .bind(command.orderId)
    .first<{ status: string; location_id: string; version: number; cycle_id: string | null }>();
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
  const legacyHash = await requestHash(payload);
  const hash = ports.actorAuthUserId
    ? await requestHash({ ...payload, actor: ports.actorAuthUserId, reason: ports.reason ?? null })
    : legacyHash;
  const { location_id: locationId, cycle_id: cycleId } = row;
  async function replay(): Promise<AdvanceFulfillmentResult | null> {
    const record = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
    if (!record) return null;
    const retained =
      record.requestHash === legacyHash && record.resultReference === command.orderId;
    const retainedUnapplied =
      record.requestHash === legacyHash &&
      record.resultReference === null &&
      record.status !== "SUCCEEDED";
    if (record.requestHash !== hash && !retained && !retainedUnapplied)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (record.status === "SUCCEEDED")
      return {
        ok: true,
        requestId: command.requestId,
        value: retained
          ? {
              id: command.orderId,
              status: ACTION_TARGET[command.action],
              version: command.expectedVersion + 1,
              locationId,
              cycleId,
            }
          : resultSchema.parse(JSON.parse(record.resultReference ?? "null")),
      };
    if (record.status === "PROCESSING" && !retainedUnapplied)
      return failure(
        "CONFLICT",
        "The original fulfillment command requires reconciliation before retry",
        command.requestId,
      );
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  const custodyAction = command.action === "HAND_OFF" || command.action === "COMPLETE";
  const manualCustodySql = `SELECT 1 FROM delivery_provider_dispatch attempt JOIN delivery_job job ON job.id=attempt.delivery_job_id
    WHERE job.order_id=? AND attempt.method='MANUAL' AND attempt.status='ACTIVE'`;
  if (custodyAction && (await database.prepare(manualCustodySql).bind(command.orderId).first()))
    return failure(
      "ILLEGAL_TRANSITION",
      "Use the manual delivery action to record handover or completion",
      command.requestId,
    );
  if (row.version !== command.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Fulfillment changed; refresh before retrying",
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
  if (
    command.action === "MARK_PACKED" &&
    (order.status !== "FULFILLMENT_PENDING" || row.status !== "PACKING")
  )
    return failure("ILLEGAL_TRANSITION", "Order is not being prepared", command.requestId);
  const transitionResult = transitionToResult(
    row.status,
    ACTION_TARGET[command.action],
    fulfillmentTransitions,
    command.requestId,
  );
  if (!transitionResult.ok) return transitionResult;
  const next = transitionResult.value;
  const result = resultSchema.parse({
    id: command.orderId,
    status: next,
    version: row.version + 1,
    locationId: row.location_id,
    cycleId: row.cycle_id,
  });
  try {
    const now = Date.now();
    const statements: D1PreparedStatement[] = [
      ...(custodyAction
        ? [
            database
              .prepare(
                `INSERT INTO commitment_abort(id) SELECT -30 WHERE EXISTS (${manualCustodySql})`,
              )
              .bind(command.orderId),
          ]
        : []),
      ...(ports.actorAuthUserId
        ? [
            database
              .prepare(`INSERT INTO commitment_abort(id) SELECT -30 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id
        JOIN permission p ON p.id=rp.permission_id AND p.code='fulfillment.manage'
        JOIN staff_scope scope ON scope.staff_id=staff.id JOIN fulfillment_location location ON location.id=?
        WHERE staff.auth_user_id=? AND staff.status='active' AND (scope.scope_kind='global' OR (scope.scope_kind='location' AND scope.location_id=location.id) OR (scope.scope_kind='market' AND scope.market_id=location.market_id))
      )`)
              .bind(row.location_id, ports.actorAuthUserId),
          ]
        : []),
      database
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
        VALUES (?,?,?,'PROCESSING','fulfillment',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET request_hash=excluded.request_hash,status='PROCESSING',result_reference=NULL,updated_at=excluded.updated_at
        WHERE (idempotency_records.status='FAILED' AND idempotency_records.request_hash IN (?,?)) OR (idempotency_records.status='PROCESSING' AND idempotency_records.request_hash=? AND idempotency_records.result_reference IS NULL)`)
        .bind(SCOPE, command.idempotencyKey, hash, now, now, hash, legacyHash, legacyHash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -30 WHERE changes()<>1"),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -30 WHERE NOT EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status=? AND version=?)",
        )
        .bind(command.orderId, order.status, order.version),
      database
        .prepare(
          "UPDATE fulfillment_record SET status=?, updated_at=?, version=version+1 WHERE order_id=? AND version=? AND status=? AND location_id=?",
        )
        .bind(next, now, command.orderId, command.expectedVersion, row.status, row.location_id),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -30 WHERE changes()!=1"),
    ];
    if (command.action === "START_PICKING") {
      // Acceptance must still have paid evidence when it wins against cancellation.
      // A retained pre-canonical Order may have only its successful Payment attempt.
      statements.push(
        database
          .prepare(`INSERT INTO commitment_abort(id) SELECT -30 WHERE NOT EXISTS (
          SELECT 1 FROM grocery_order grocery
          JOIN payment_attempt attempt ON attempt.id=grocery.payment_id
          LEFT JOIN payment_intent payment ON payment.id=attempt.payment_intent_id
          WHERE grocery.id=? AND attempt.status='SUCCEEDED'
            AND attempt.customer_id=grocery.customer_id
            AND attempt.amount_minor=grocery.total_minor AND attempt.currency=grocery.currency
            AND (attempt.payment_intent_id IS NULL OR (
              payment.status='SUCCEEDED' AND payment.customer_id=grocery.customer_id
              AND payment.amount_minor=grocery.total_minor AND payment.currency=grocery.currency
            ))
        )`)
          .bind(command.orderId),
      );
    }
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
    if (command.action === "MARK_PACKED" && order.fulfillment_mode === "SCHEDULED") {
      statements.push(
        ...consumeCycleGoodsStatements(database, {
          orderId: command.orderId,
          cycleId,
          locationId,
          actorUserId: ports.actorAuthUserId ?? null,
          now,
        }),
      );
    }
    statements.push(
      auditEventStatement(database, {
        actorUserId: ports.actorAuthUserId ?? null,
        action: "OPERATIONS.FULFILLMENT_ADVANCED",
        resourceType: "fulfillment_record",
        resourceId: command.orderId,
        locationId: row.location_id,
        reason: ports.reason ?? null,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.requestId,
        occurredAt: now,
        before: { status: row.status, version: row.version },
        after: { status: next, version: result.version },
      }),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -30 WHERE changes()<>1"),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(result), now, SCOPE, command.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -30 WHERE changes()<>1"),
    );
    await database.batch(statements);
  } catch (error) {
    const replayed = await replay();
    if (replayed) return replayed;
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
    value: result,
    requestId: command.requestId,
  };
}
