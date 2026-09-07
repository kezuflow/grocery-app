import type { RefundState } from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import {
  canTransitionOrder,
  orderLifecycleStates,
  type OrderLifecycleState,
} from "../domain/order-state-machine";
import {
  decideOrderCancellation,
  type CancellationActor,
  type CancellationCause,
} from "../domain/cancellation-policy";
import {
  advanceOrderCancellation,
  synchronizeOrderCancellationForPayment,
} from "./advance-order-cancellation";
import { buildCancellationRefundSet } from "./build-cancellation-refund-set";
import { projectOrderCancellationNotification } from "../../notifications/application/project-domain-notifications";

export type CancelOrderCommand = {
  orderId: string;
  expectedVersion: number;
  reasonCode?: string;
  reason?: string;
  actor?: CancellationActor;
  cause?: CancellationCause;
  customerId?: string;
  idempotencyKey: string;
  requestId: string;
};

export type CancelOrderOutcome = {
  state: "CANCELED" | "CANCELLATION_REQUESTED" | "UNCHANGED";
  cancellationId?: string;
  status?: "REQUESTED" | "REFUNDS_PROCESSING" | "COMPLETED" | "EXCEPTION";
  requiredRefundMinor?: number;
  retainedServiceFeeMinor?: number;
  currency?: string;
  refunds?: readonly {
    paymentId: string;
    refundId: string | null;
    amountMinor: number;
    status: RefundState | "NOT_REQUESTED";
  }[];
  refundState?: "PROCESSING" | "REJECTED" | null;
};

type CancelPorts = {
  requestRefund?: (input: {
    paymentIntentId: string;
    amountMinor: number;
    reason: string;
    idempotencyKey: string;
  }) => Promise<
    | { ok: true; refundId?: string; refundState?: RefundState }
    | { ok: false; refundId?: string; refundState?: RefundState }
  >;
  evidence?: (guard: {
    clause: string;
    binds: ReadonlyArray<unknown>;
    outcome: CancelOrderOutcome["state"];
  }) => ReadonlyArray<D1PreparedStatement>;
};

export async function requestOrderCancellation(
  database: D1Database,
  command: CancelOrderCommand,
  ports?: CancelPorts,
): Promise<
  | { ok: true; value: CancelOrderOutcome; requestId: string }
  | { ok: false; error: { code: string; message: string; requestId: string } }
> {
  const scope = "orders.cancel";
  if (command.customerId !== undefined) {
    const owned = await database
      .prepare("SELECT id FROM grocery_order WHERE id=? AND customer_id=?")
      .bind(command.orderId, command.customerId)
      .first();
    if (!owned) return failure("NOT_FOUND", "Order not found", command.requestId);
  }
  const actor = command.actor ?? "CUSTOMER";
  const cause = command.cause ?? (actor === "CUSTOMER" ? "CUSTOMER_REQUEST" : "OTHER");
  const reason = (command.reason ?? command.reasonCode ?? "").trim();
  const claim = await claimCommandIdempotency(database, Date.now, scope, command.idempotencyKey, {
    orderId: command.orderId,
    expectedVersion: command.expectedVersion,
    actor,
    cause,
    reason,
  });
  if (!claim.claimed) {
    if (claim.existing?.requestHash !== claim.hash)
      return failure("IDEMPOTENCY_CONFLICT", "Cancellation key conflict", command.requestId);
    const existing = await cancellationView(database, command.orderId);
    if (claim.existing?.status === "SUCCEEDED" && existing)
      return { ok: true, value: existing, requestId: command.requestId };
    return failure("CONFLICT", "Cancellation already processing", command.requestId);
  }

  try {
    if (!reason) throw appError("VALIDATION_FAILED", "A cancellation reason is required");
    const order = await database
      .prepare(
        `SELECT id,customer_id,status,version,fulfillment_mode,total_minor,currency,service_fee_minor
         FROM grocery_order WHERE id=?`,
      )
      .bind(command.orderId)
      .first<{
        id: string;
        customer_id: string;
        status: string;
        version: number;
        fulfillment_mode: "INSTANT" | "SCHEDULED";
        total_minor: number;
        currency: string;
        service_fee_minor: number;
      }>();
    if (!order || (command.customerId && command.customerId !== order.customer_id))
      throw appError("NOT_FOUND", "Order not found");
    if (order.version !== command.expectedVersion)
      throw appError("STALE_VERSION", "Order changed; refresh");
    // Orders that never reached a canonical payment keep the legacy direct
    // cancellation path. This check must precede paid-order policy because a
    // PENDING_PAYMENT order has no financial operation to review.
    const initialSet = await buildCancellationRefundSet(database, order.id, 0);
    if (!initialSet) {
      assertLegalTransition(order.status, "CANCELED");
      await database.batch([
        database
          .prepare(
            "UPDATE grocery_order SET status='CANCELED',version=version+1 WHERE id=? AND status=? AND version=?",
          )
          .bind(order.id, order.status, order.version),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -20 WHERE changes()!=1"),
        ...releaseOperationalEffectStatements(database, order.id),
        database
          .prepare(
            "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
          )
          .bind(order.id, Date.now(), scope, command.idempotencyKey),
      ]);
      return { ok: true, value: { state: "CANCELED" }, requestId: command.requestId };
    }
    const existingRefund = await database
      .prepare(
        `SELECT 1 AS found FROM payment_refund
         WHERE payment_intent_id IN (${initialSet.members.map(() => "?").join(",")})
         LIMIT 1`,
      )
      .bind(...initialSet.members.map((member) => member.paymentIntentId))
      .first<{ found: number }>();
    if (existingRefund)
      throw appError(
        "FINANCIAL_OPERATION_REQUIRES_REVIEW",
        "An existing refund must be reconciled before coordinated cancellation",
      );
    const snapshot = await database
      .prepare("SELECT cutoff_at FROM order_fulfillment_snapshot WHERE order_id=?")
      .bind(order.id)
      .first<{ cutoff_at: number | null }>();
    const policy = decideOrderCancellation({
      actor,
      cause,
      mode: order.fulfillment_mode,
      orderState: asOrderState(order.status),
      serviceFeeMinor: order.service_fee_minor ?? 0,
      grossPaidMinor: initialSet.grossPaidMinor,
      now: Date.now(),
      cutoffAt: snapshot?.cutoff_at ?? null,
    });
    if (!policy.allowed) throwPolicy(policy.code);
    const refundSet = await buildCancellationRefundSet(
      database,
      order.id,
      policy.retainedServiceFeeMinor,
    );
    if (!refundSet) throw appError("CONFLICT", "Refund set could not be resolved");

    const cancellationId = crypto.randomUUID();
    const nextOrderState = cancellationOrderState(actor, asOrderState(order.status));
    const now = Date.now();
    const guard = {
      clause: "EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status=? AND version=?)",
      binds: [order.id, nextOrderState, order.version + (nextOrderState === order.status ? 0 : 1)],
      outcome: "CANCELLATION_REQUESTED" as const,
    };
    const statements: D1PreparedStatement[] = [
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status=? AND version=?)",
        )
        .bind(order.id, order.status, order.version),
    ];
    if (nextOrderState !== order.status)
      statements.push(
        database
          .prepare(
            "UPDATE grocery_order SET status=?,version=version+1 WHERE id=? AND status=? AND version=?",
          )
          .bind(nextOrderState, order.id, order.status, order.version),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -20 WHERE changes()!=1"),
      );
    statements.push(
      database
        .prepare(
          `INSERT INTO order_cancellation
           (id,order_id,actor_type,cause,reason,status,retained_service_fee_minor,
            required_refund_minor,currency,version,created_at,updated_at)
           VALUES (?,?,?,?,?,'REQUESTED',?,?,?,1,?,?)`,
        )
        .bind(
          cancellationId,
          order.id,
          actor,
          cause,
          reason,
          policy.retainedServiceFeeMinor,
          policy.refundMinor,
          refundSet.currency,
          now,
          now,
        ),
      ...refundSet.members.map((member) =>
        database
          .prepare(
            `INSERT INTO order_cancellation_refund_member
             (id,cancellation_id,payment_intent_id,required_amount_minor,currency,refund_id,status,attempts,created_at,updated_at)
             VALUES (?,?,?,?,?,NULL,'NOT_REQUESTED',0,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            cancellationId,
            member.paymentIntentId,
            member.requiredAmountMinor,
            member.currency,
            now,
            now,
          ),
      ),
      ...releaseOperationalEffectStatements(database, order.id),
      database
        .prepare(
          "UPDATE paid_order_amendment SET status='CANCELED',version=version+1,updated_at=? WHERE order_id=? AND status IN ('DRAFT','PENDING_PAYMENT')",
        )
        .bind(now, order.id),
      ...(ports?.evidence?.(guard) ?? []),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(cancellationId, now, scope, command.idempotencyKey),
    );
    await database.batch(statements);
    await projectCancellationSafely(database, cancellationId, "REQUESTED");

    for (const member of refundSet.members) {
      if (!ports?.requestRefund) continue;
      const requested = await ports.requestRefund({
        paymentIntentId: member.paymentIntentId,
        amountMinor: member.requiredAmountMinor,
        reason,
        idempotencyKey: `order-cancel:${cancellationId}:${member.paymentIntentId}`,
      });
      // The adapter result may have lost the canonical refund identity or be
      // older than a webhook. Reconcile by our durable key before projecting.
      await synchronizeOrderCancellationForPayment(database, member.paymentIntentId);
      await database
        .prepare(
          `UPDATE order_cancellation_refund_member
           SET attempts=attempts+1,updated_at=?
           WHERE cancellation_id=? AND payment_intent_id=?`,
        )
        .bind(Date.now(), cancellationId, member.paymentIntentId)
        .run();
      if (!requested.ok)
        await database
          .prepare(
            "UPDATE order_cancellation SET status='EXCEPTION',version=version+1,updated_at=? WHERE id=? AND status NOT IN ('COMPLETED','EXCEPTION')",
          )
          .bind(Date.now(), cancellationId)
          .run();
    }
    if (refundSet.members.length === 0)
      await finalizeZeroRefund(database, cancellationId, order.id, actor);
    else
      await database
        .prepare(
          "UPDATE order_cancellation SET status='REFUNDS_PROCESSING',version=version+1,updated_at=? WHERE id=? AND status='REQUESTED'",
        )
        .bind(Date.now(), cancellationId)
        .run();
    const finalView = (await cancellationView(database, order.id))!;
    if (finalView.status)
      await projectCancellationSafely(database, cancellationId, finalView.status);
    return {
      ok: true,
      value: finalView,
      requestId: command.requestId,
    };
  } catch (error) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED',updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), scope, command.idempotencyKey)
      .run();
    const currentOrder = await database
      .prepare("SELECT version FROM grocery_order WHERE id=?")
      .bind(command.orderId)
      .first<{ version: number }>();
    if (
      (currentOrder && currentOrder.version !== command.expectedVersion) ||
      (error instanceof Error && error.message.includes("CHECK constraint failed: id = 0"))
    )
      return failure(
        "STALE_VERSION",
        "Order or operational commitments changed; refresh",
        command.requestId,
      );
    const detail = error as { code?: string; message?: string };
    return failure(
      detail.code ?? "INTERNAL_ERROR",
      detail.message ?? "Cancellation failed",
      command.requestId,
    );
  }
}

async function projectCancellationSafely(
  database: D1Database,
  cancellationId: string,
  state: "REQUESTED" | "REFUNDS_PROCESSING" | "COMPLETED" | "EXCEPTION",
): Promise<void> {
  try {
    await projectOrderCancellationNotification(database, { cancellationId, state });
  } catch {
    // Notification delivery intent is retryable and never owns cancellation.
  }
}

export const cancelOrder = requestOrderCancellation;

export async function applyOrderRefundObservation(
  database: D1Database,
  input: { paymentIntentId: string; refundId?: string },
): Promise<{ applied: boolean }> {
  const refund = await database
    .prepare(
      "SELECT id,status FROM payment_refund WHERE payment_intent_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC LIMIT 1",
    )
    .bind(input.paymentIntentId, input.refundId ?? null, input.refundId ?? null)
    .first<{ id: string; status: RefundState }>();
  if (!refund) return { applied: false };
  const result = await advanceOrderCancellation(database, {
    paymentIntentId: input.paymentIntentId,
    refundId: refund.id,
    refundState: refund.status,
  });
  return { applied: result.applied || result.completed };
}

function cancellationOrderState(
  actor: CancellationActor,
  state: OrderLifecycleState,
): OrderLifecycleState {
  if (actor === "STAFF_EXCEPTION" && state === "DELIVERED") return state;
  if (canTransitionOrder(state, "CANCELLATION_REQUESTED")) return "CANCELLATION_REQUESTED";
  if (canTransitionOrder(state, "EXCEPTION")) return "EXCEPTION";
  throw appError("ILLEGAL_TRANSITION", `Order cannot transition from ${state}`);
}

async function cancellationView(
  database: D1Database,
  orderId: string,
): Promise<CancelOrderOutcome | null> {
  const cancellation = await database
    .prepare(
      "SELECT id,status,retained_service_fee_minor,required_refund_minor,currency FROM order_cancellation WHERE order_id=?",
    )
    .bind(orderId)
    .first<{
      id: string;
      status: CancelOrderOutcome["status"];
      retained_service_fee_minor: number;
      required_refund_minor: number;
      currency: string;
    }>();
  if (!cancellation) return null;
  const order = await database
    .prepare("SELECT status FROM grocery_order WHERE id=?")
    .bind(orderId)
    .first<{ status: string }>();
  const members = await database
    .prepare(
      "SELECT payment_intent_id,refund_id,required_amount_minor,status FROM order_cancellation_refund_member WHERE cancellation_id=? ORDER BY created_at,id",
    )
    .bind(cancellation.id)
    .all<{
      payment_intent_id: string;
      refund_id: string | null;
      required_amount_minor: number;
      status: RefundState | "NOT_REQUESTED";
    }>();
  return {
    state: order?.status === "CANCELED" ? "CANCELED" : "CANCELLATION_REQUESTED",
    cancellationId: cancellation.id,
    status: cancellation.status,
    requiredRefundMinor: cancellation.required_refund_minor,
    retainedServiceFeeMinor: cancellation.retained_service_fee_minor,
    currency: cancellation.currency,
    refunds: members.results.map((member) => ({
      paymentId: member.payment_intent_id,
      refundId: member.refund_id,
      amountMinor: member.required_amount_minor,
      status: member.status,
    })),
    refundState: members.results.some((member) => member.status === "REJECTED")
      ? "REJECTED"
      : members.results.length
        ? "PROCESSING"
        : null,
  };
}

async function finalizeZeroRefund(
  database: D1Database,
  cancellationId: string,
  orderId: string,
  actor: CancellationActor,
) {
  await database.batch([
    database
      .prepare(
        "UPDATE order_cancellation SET status='COMPLETED',version=version+1,updated_at=? WHERE id=?",
      )
      .bind(Date.now(), cancellationId),
    database
      .prepare(
        "UPDATE grocery_order SET status='CANCELED',version=version+1 WHERE id=? AND status IN ('CANCELLATION_REQUESTED','EXCEPTION') AND ?!='STAFF_EXCEPTION'",
      )
      .bind(orderId, actor),
  ]);
}

function releaseOperationalEffectStatements(
  database: D1Database,
  orderId: string,
): D1PreparedStatement[] {
  return [
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -21 WHERE EXISTS (
          SELECT 1 FROM inventory_reservation r
          LEFT JOIN inventory_balance b ON b.location_id=r.location_id AND b.inventory_pool_id=r.inventory_pool_id
          WHERE r.order_id=? AND r.status='RESERVED'
          GROUP BY r.location_id,r.inventory_pool_id
          HAVING b.reserved IS NULL OR b.reserved<SUM(r.quantity))`,
      )
      .bind(orderId),
    database
      .prepare(
        `INSERT INTO inventory_ledger_entries
         (id,inventory_pool_id,location_id,movement_type,quantity_delta_base,reservation_delta_base,
          reference_type,reference_id,actor_type,reason_code,metadata_json,created_at,idempotency_key)
         SELECT 'cancel-release:'||r.id,r.inventory_pool_id,r.location_id,'RESERVATION_RELEASE',0,-r.quantity,
                'grocery_order',r.order_id,'SYSTEM','ORDER_CANCELLATION','{}',?,'cancel-release:'||r.id
         FROM inventory_reservation r WHERE r.order_id=? AND r.status='RESERVED'`,
      )
      .bind(Date.now(), orderId),
    database
      .prepare(
        "UPDATE inventory_balance SET reserved=reserved-(SELECT COALESCE(SUM(quantity),0) FROM inventory_reservation r WHERE r.order_id=? AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id AND r.status='RESERVED'),version=version+1 WHERE EXISTS (SELECT 1 FROM inventory_reservation r WHERE r.order_id=? AND r.status='RESERVED' AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id)",
      )
      .bind(orderId, orderId),
    database
      .prepare(
        "UPDATE inventory_reservation SET status='RELEASED',version=version+1 WHERE order_id=? AND status='RESERVED'",
      )
      .bind(orderId),
    database
      .prepare(
        "UPDATE committed_demand SET status='CANCELED',version=version+1 WHERE order_id=? AND status='OPEN'",
      )
      .bind(orderId),
  ];
}

function asOrderState(value: string): OrderLifecycleState {
  if (!orderLifecycleStates.includes(value as OrderLifecycleState))
    throw appError("ILLEGAL_TRANSITION", `Unknown Order state ${value}`);
  return value as OrderLifecycleState;
}

function assertLegalTransition(from: string, to: OrderLifecycleState) {
  if (!canTransitionOrder(asOrderState(from), to))
    throw appError("ILLEGAL_TRANSITION", `Order cannot transition from ${from} to ${to}`);
}

function throwPolicy(code: string): never {
  const errorCode =
    code === "CANCELLATION_WINDOW_CLOSED"
      ? "FINANCIAL_OPERATION_REQUIRES_REVIEW"
      : code === "CUTOFF_EVIDENCE_MISSING"
        ? "CONFIGURATION_ERROR"
        : "ILLEGAL_TRANSITION";
  throw appError(
    errorCode,
    code === "CANCELLATION_WINDOW_CLOSED"
      ? "The customer cancellation window is closed"
      : code === "CUTOFF_EVIDENCE_MISSING"
        ? "The scheduled order cutoff snapshot is missing"
        : "Order is not cancelable",
  );
}

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function appError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
