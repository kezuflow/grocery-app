import { zeroRefundCancellationStatements } from "./complete-zero-refund-cancellation";
import type { RefundState } from "@freshmarkets/contracts";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
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
import { advanceOrderCancellation } from "./advance-order-cancellation";
import {
  resumeCancellationRefunds,
  type CancellationRefundPort,
} from "./resume-cancellation-refunds";
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
  actorAuthUserId?: string;
  resolution?: string;
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

const cancellationOutcomeSchema = z.object({
  state: z.enum(["CANCELED", "CANCELLATION_REQUESTED", "UNCHANGED"]),
  cancellationId: z.string().optional(),
  status: z.enum(["REQUESTED", "REFUNDS_PROCESSING", "COMPLETED", "EXCEPTION"]).optional(),
  requiredRefundMinor: z.number().int().safe().nonnegative().optional(),
  retainedServiceFeeMinor: z.number().int().safe().nonnegative().optional(),
  currency: z.string().optional(),
  refunds: z
    .array(
      z.object({
        paymentId: z.string(),
        refundId: z.string().nullable(),
        amountMinor: z.number().int().safe().nonnegative(),
        status: z.enum([
          "NOT_REQUESTED",
          "REQUESTED",
          "APPROVED",
          "PROCESSING",
          "SUCCEEDED",
          "REJECTED",
          "FAILED",
          "ESCALATED",
        ]),
      }),
    )
    .optional(),
  refundState: z.enum(["PROCESSING", "REJECTED"]).nullable().optional(),
});

type CancelPorts = {
  now?: () => number;
  requestRefund?: CancellationRefundPort;
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
  const nowClock = ports?.now ?? Date.now;
  const legacyHash = await requestHash({
    orderId: command.orderId,
    expectedVersion: command.expectedVersion,
    actor,
    cause,
    reason,
  });
  const hash = await requestHash({
    orderId: command.orderId,
    expectedVersion: command.expectedVersion,
    actor,
    cause,
    reason,
    authUserId: command.actorAuthUserId ?? null,
    customerId: command.customerId ?? null,
    resolution: command.resolution ?? null,
  });
  async function replay() {
    const saved = await findIdempotencyRecord(database, scope, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash && saved.requestHash !== legacyHash)
      return failure("IDEMPOTENCY_CONFLICT", "Cancellation key conflict", command.requestId);
    if (saved.status === "SUCCEEDED") {
      if (!saved.resultReference?.startsWith("{"))
        return failure(
          "CONFLICT",
          "This historical cancellation already applied; review its current progress",
          command.requestId,
        );
      return {
        ok: true as const,
        value: cancellationOutcomeSchema.parse(JSON.parse(saved.resultReference)),
        requestId: command.requestId,
      };
    }
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  function admission(now: number): D1PreparedStatement[] {
    const guards: D1PreparedStatement[] = [];
    if (command.actorAuthUserId) {
      if (actor === "CUSTOMER")
        guards.push(
          database
            .prepare(`INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (
        SELECT 1 FROM customer customer JOIN grocery_order grocery ON grocery.customer_id=customer.id
        WHERE grocery.id=? AND customer.id=? AND customer.auth_user_id=? AND customer.status='active')`)
            .bind(command.orderId, command.customerId ?? null, command.actorAuthUserId),
        );
      else
        guards.push(
          database
            .prepare(`INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
        JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission permission ON permission.id=rp.permission_id
        JOIN staff_scope scope ON scope.staff_id=staff.id AND scope.scope_kind='global'
        WHERE staff.auth_user_id=? AND staff.status='active' AND permission.code=?)`)
            .bind(
              command.actorAuthUserId,
              actor === "STAFF_EXCEPTION" ? "refunds.manage" : "orders.manage",
            ),
        );
    }
    if (command.customerId)
      guards.push(
        database
          .prepare(
            "INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND customer_id=?)",
          )
          .bind(command.orderId, command.customerId),
      );
    guards.push(
      database
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
      VALUES (?,?,?,'PROCESSING','order_cancellation',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET request_hash=excluded.request_hash,status='PROCESSING',result_reference=NULL,updated_at=excluded.updated_at
      WHERE idempotency_records.status IN ('PROCESSING','FAILED') AND idempotency_records.request_hash IN (?,?)`)
        .bind(scope, command.idempotencyKey, hash, now, now, hash, legacyHash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -20 WHERE changes()!=1"),
    );
    return guards;
  }
  function saveResult(value: CancelOrderOutcome, now: number): D1PreparedStatement[] {
    return [
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE action='ORDER.CANCELED' AND aggregate_id=? AND idempotency_key=?)",
        )
        .bind(command.orderId, command.idempotencyKey),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(value), now, scope, command.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -20 WHERE changes()!=1"),
    ];
  }
  function evidence(outcome: CancelOrderOutcome["state"], status: string, version: number) {
    const guard = {
      clause: "EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status=? AND version=?)",
      binds: [command.orderId, status, version],
      outcome,
    };
    return (
      ports?.evidence?.(guard) ?? [
        auditEventStatement(
          database,
          {
            actorUserId: command.actorAuthUserId ?? null,
            action: "ORDER.CANCELED",
            resourceType: "order",
            resourceId: command.orderId,
            reason,
            idempotencyKey: command.idempotencyKey,
            details: { outcome, resolution: command.resolution ?? null },
            correlationId: command.requestId,
            occurredAt: nowClock(),
          },
          guard,
        ),
      ]
    );
  }

  try {
    if (
      !reason ||
      !Number.isSafeInteger(command.expectedVersion) ||
      command.expectedVersion < 1 ||
      !command.idempotencyKey.trim()
    )
      throw appError(
        "VALIDATION_FAILED",
        "A cancellation reason, version and stable key are required",
      );
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
      if (actor === "CUSTOMER" && command.actorAuthUserId)
        throw appError(
          "ILLEGAL_TRANSITION",
          "This order has no paid cancellation operation; review checkout progress",
        );
      if (order.status !== "PENDING_PAYMENT")
        throw appError(
          "FINANCIAL_OPERATION_REQUIRES_REVIEW",
          "Paid evidence must be reconciled before cancellation",
        );
      assertLegalTransition(order.status, "CANCELED");
      const accepted: CancelOrderOutcome = { state: "CANCELED" };
      await database.batch([
        ...admission(nowClock()),
        database
          .prepare(`INSERT INTO commitment_abort(id) SELECT -20 WHERE EXISTS (
          SELECT 1 FROM order_payment_reaction WHERE order_id=?) OR EXISTS (
          SELECT 1 FROM paid_order_amendment WHERE order_id=? AND status='COMMITTED') OR EXISTS (
          SELECT 1 FROM grocery_order grocery JOIN payment_attempt payment ON payment.id=grocery.payment_id
          WHERE grocery.id=? AND payment.status='SUCCEEDED')`)
          .bind(order.id, order.id, order.id),
        database
          .prepare(
            "UPDATE grocery_order SET status='CANCELED',version=version+1 WHERE id=? AND status=? AND version=?",
          )
          .bind(order.id, order.status, order.version),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -20 WHERE changes()!=1"),
        ...releaseOperationalEffectStatements(database, order.id),
        ...evidence("CANCELED", "CANCELED", order.version + 1),
        ...saveResult(accepted, nowClock()),
      ]);
      return { ok: true, value: accepted, requestId: command.requestId };
    }
    if (
      actor === "CUSTOMER" &&
      order.service_fee_minor > 0 &&
      initialSet.previouslyRefundedMinor > 0
    )
      throw appError(
        "FINANCIAL_OPERATION_REQUIRES_REVIEW",
        "Historical fee/refund components require financial review before customer cancellation",
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
      now: nowClock(),
      cutoffAt: snapshot?.cutoff_at ?? null,
    });
    if (!policy.allowed) throwPolicy(policy.code);
    const refundSet = {
      ...initialSet,
      members: initialSet.members
        .map((member) => ({
          ...member,
          requiredAmountMinor:
            member.requiredAmountMinor -
            (member.source === "ORDER" ? policy.retainedServiceFeeMinor : 0),
        }))
        .filter((member) => member.requiredAmountMinor !== 0),
    };
    if (refundSet.members.some((member) => member.requiredAmountMinor < 0))
      throw appError(
        "FINANCIAL_OPERATION_REQUIRES_REVIEW",
        "Historical retained fee exceeds its original payment",
      );

    const cancellationId = crypto.randomUUID();
    const nextOrderState = cancellationOrderState(actor, asOrderState(order.status));
    const now = nowClock();
    const accepted: CancelOrderOutcome = {
      state: "CANCELLATION_REQUESTED",
      cancellationId,
      status: refundSet.members.length === 0 ? "COMPLETED" : "REQUESTED",
      requiredRefundMinor: policy.refundMinor - initialSet.previouslyRefundedMinor,
      retainedServiceFeeMinor: policy.retainedServiceFeeMinor,
      currency: refundSet.currency,
      refunds: refundSet.members.map((member) => ({
        paymentId: member.paymentIntentId,
        refundId: null,
        amountMinor: member.requiredAmountMinor,
        status: "NOT_REQUESTED",
      })),
      refundState: refundSet.members.length ? "PROCESSING" : null,
    };
    const statements: D1PreparedStatement[] = [
      ...admission(now),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status=? AND version=?)",
        )
        .bind(order.id, order.status, order.version),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -20 WHERE
        (SELECT COUNT(*) FROM order_payment_reaction WHERE order_id=?)+(SELECT COUNT(*) FROM paid_order_amendment WHERE order_id=? AND status='COMMITTED')!=?`)
        .bind(order.id, order.id, initialSet.members.length),
      ...initialSet.members.map((member) =>
        database
          .prepare(`INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (
        SELECT 1 FROM payment_intent payment WHERE payment.id=? AND payment.status=? AND payment.version=?
        AND payment.amount_minor=? AND payment.currency=? AND (
          (?='ORDER' AND EXISTS (SELECT 1 FROM order_payment_reaction WHERE order_id=? AND payment_intent_id=payment.id)) OR
          (?='AMENDMENT' AND EXISTS (SELECT 1 FROM paid_order_amendment WHERE order_id=? AND status='COMMITTED' AND payment_intent_id=payment.id))))
        OR (SELECT COALESCE(SUM(amount_minor),0) FROM payment_refund WHERE payment_intent_id=? AND status='SUCCEEDED')!=?
        OR EXISTS (SELECT 1 FROM payment_refund WHERE payment_intent_id=? AND (status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED') OR next_retry_at IS NOT NULL))`)
          .bind(
            member.paymentIntentId,
            member.paymentStatus,
            member.paymentVersion,
            member.capturedAmountMinor,
            member.currency,
            member.source,
            order.id,
            member.source,
            order.id,
            member.paymentIntentId,
            member.refundedMinor,
            member.paymentIntentId,
          ),
      ),
    ];
    if (actor === "CUSTOMER" && order.fulfillment_mode === "SCHEDULED")
      statements.push(
        database
          .prepare(
            "INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (SELECT 1 FROM order_fulfillment_snapshot WHERE order_id=? AND cutoff_at=? AND cutoff_at>?)",
          )
          .bind(order.id, snapshot?.cutoff_at ?? null, now),
      );
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
          policy.refundMinor - initialSet.previouslyRefundedMinor,
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
      ...(refundSet.members.length === 0
        ? zeroRefundCancellationStatements(database, {
            cancellationId,
            orderId: order.id,
            orderVersion: order.version + (nextOrderState === order.status ? 0 : 1),
            now,
          })
        : []),
      ...evidence(
        accepted.state,
        refundSet.members.length === 0 && actor !== "STAFF_EXCEPTION" ? "CANCELED" : nextOrderState,
        order.version +
          (nextOrderState === order.status ? 0 : 1) +
          (refundSet.members.length === 0 && actor !== "STAFF_EXCEPTION" ? 1 : 0),
      ),
      ...saveResult(accepted, now),
    );
    await database.batch(statements);
    if (refundSet.members.length > 0)
      await projectCancellationSafely(database, cancellationId, "REQUESTED");

    if (ports?.requestRefund)
      await resumeCancellationRefunds(database, cancellationId, ports.requestRefund, nowClock());
    if (refundSet.members.length > 0)
      await database
        .prepare(
          "UPDATE order_cancellation SET status='REFUNDS_PROCESSING',version=version+1,updated_at=? WHERE id=? AND status='REQUESTED'",
        )
        .bind(nowClock(), cancellationId)
        .run();
    const finalView = (await cancellationView(database, order.id))!;
    if (finalView.status)
      await projectCancellationSafely(database, cancellationId, finalView.status);
    return {
      ok: true,
      value: accepted,
      requestId: command.requestId,
    };
  } catch (error) {
    const committed = await replay();
    if (committed) return committed;
    const currentOrder = await database
      .prepare("SELECT version FROM grocery_order WHERE id=?")
      .bind(command.orderId)
      .first<{ version: number }>();
    if (
      (currentOrder && currentOrder.version !== command.expectedVersion) ||
      (error instanceof Error &&
        /CHECK constraint failed|UNIQUE constraint failed/.test(error.message))
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
