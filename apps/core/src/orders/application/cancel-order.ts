import { claimCommandIdempotency } from "../../idempotency";
import {
  canTransitionOrder,
  orderLifecycleStates,
  type OrderLifecycleState,
} from "../domain/order-state-machine";

export type CancelOrderCommand = {
  orderId: string;
  expectedVersion: number;
  reasonCode: string;
  idempotencyKey: string;
  requestId: string;
};

export type CancelOrderOutcome = {
  state: "CANCELED" | "CANCELLATION_REQUESTED" | "UNCHANGED";
  refundState?: "PROCESSING" | "REJECTED" | null;
};

type OrderRow = {
  id: string;
  status: string;
  version: number;
  total_minor: number;
  currency: string;
};

/**
 * Explicit, versioned order cancellation. Pre-payment abandonment cancels
 * directly; a paid pre-cutoff cancellation requests the canonical Payments
 * refund and waits for its outcome (financial and operational states stay
 * separate); post-cutoff paid cancellation is rejected to manual exception.
 * Stocked reservations are released; planned demand is canceled — mirroring
 * the sourcing actually committed.
 */
export async function cancelOrder(
  database: D1Database,
  command: CancelOrderCommand,
  ports?: {
    requestRefund?: (input: {
      paymentIntentId: string;
      amountMinor: number;
      reason: string;
      idempotencyKey: string;
    }) => Promise<{ ok: boolean; refundState?: "PROCESSING" | "REJECTED" }>;
    evidence?: (guard: {
      clause: string;
      binds: ReadonlyArray<unknown>;
      outcome: CancelOrderOutcome["state"];
    }) => ReadonlyArray<D1PreparedStatement>;
  },
): Promise<
  | { ok: true; value: CancelOrderOutcome; requestId: string }
  | { ok: false; error: { code: string; message: string; requestId: string } }
> {
  const scope = "orders.cancel";
  const idempotency = await claimCommandIdempotency(
    database,
    Date.now,
    scope,
    command.idempotencyKey,
    {
      orderId: command.orderId,
      expectedVersion: command.expectedVersion,
      reasonCode: command.reasonCode,
    },
  );
  if (!idempotency.claimed) {
    if (idempotency.existing?.requestHash !== idempotency.hash) {
      return {
        ok: false,
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency key was used with a different cancellation request",
          requestId: command.requestId,
        },
      };
    }
    if (
      idempotency.existing?.status === "SUCCEEDED" &&
      idempotency.existing.resultReference === command.orderId
    ) {
      const replayed = await database
        .prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(command.orderId)
        .first<{ status: string }>();
      if (replayed) {
        const state: CancelOrderOutcome["state"] =
          replayed.status === "CANCELED" || replayed.status === "CANCELLATION_REQUESTED"
            ? replayed.status
            : "UNCHANGED";
        return { ok: true, value: { state }, requestId: command.requestId };
      }
    }
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Cancellation already processing",
        requestId: command.requestId,
      },
    };
  }

  try {
    const order = await database
      .prepare("SELECT id, status, version, total_minor, currency FROM grocery_order WHERE id=?")
      .bind(command.orderId)
      .first<OrderRow>();
    if (!order) throw httpError("NOT_FOUND", "Order not found");
    if (order.version !== command.expectedVersion)
      throw httpError("STALE_VERSION", "Order changed; refresh");

    const reaction = await database
      .prepare("SELECT r.payment_intent_id FROM order_payment_reaction r WHERE r.order_id=?")
      .bind(command.orderId)
      .first<{ payment_intent_id: string }>();

    const now = Date.now();

    if (!reaction) {
      // Pre-payment abandonment: nothing financial to unwind.
      assertLegalTransition(order.status, "CANCELED");
      const guard = orderTransitionGuard(command.orderId, "CANCELED", command.expectedVersion + 1);
      const results = await database.batch([
        transitionOrderStatement(
          database,
          command.orderId,
          order.status,
          "CANCELED",
          command.expectedVersion,
        ),
        ...releaseOperationalEffectStatements(database, command.orderId, guard),
        ...(ports?.evidence?.({ ...guard, outcome: "CANCELED" }) ?? []),
        completeScopeStatement(database, scope, command.idempotencyKey, command.orderId, guard),
      ]);
      if ((results[0]?.meta?.changes ?? 0) !== 1)
        throw httpError("STALE_VERSION", "Order changed; refresh");
      return { ok: true, value: { state: "CANCELED" }, requestId: command.requestId };
    }

    // Paid order: cutoff governs self-service cancellation.
    const snapshot = await database
      .prepare("SELECT cutoff_at FROM order_fulfillment_snapshot WHERE order_id=?")
      .bind(command.orderId)
      .first<{ cutoff_at: number }>();
    if (snapshot && snapshot.cutoff_at <= now)
      throw httpError(
        "FINANCIAL_OPERATION_REQUIRES_REVIEW",
        "Post-cutoff cancellation requires manual review",
      );

    assertLegalTransition(order.status, "CANCELLATION_REQUESTED");
    const guard = orderTransitionGuard(
      command.orderId,
      "CANCELLATION_REQUESTED",
      command.expectedVersion + 1,
    );
    const results = await database.batch([
      transitionOrderStatement(
        database,
        command.orderId,
        order.status,
        "CANCELLATION_REQUESTED",
        command.expectedVersion,
      ),
      ...(ports?.evidence?.({ ...guard, outcome: "CANCELLATION_REQUESTED" }) ?? []),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1)
      throw httpError("STALE_VERSION", "Order changed; refresh");

    let refundState: "PROCESSING" | "REJECTED" | null = null;
    if (ports?.requestRefund) {
      const outcome = await ports.requestRefund({
        paymentIntentId: reaction.payment_intent_id,
        amountMinor: order.total_minor,
        reason: command.reasonCode,
        idempotencyKey: `order-cancel:${command.orderId}`,
      });
      refundState = outcome.ok ? "PROCESSING" : "REJECTED";
    }
    await completeScope(database, scope, command.idempotencyKey, command.orderId);
    return {
      ok: true,
      value: { state: "CANCELLATION_REQUESTED", refundState },
      requestId: command.requestId,
    };
  } catch (error) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), scope, command.idempotencyKey)
      .run();
    const payload = error as { code?: string; message?: string };
    return {
      ok: false,
      error: {
        code: payload.code ?? "INTERNAL_ERROR",
        message: payload.message ?? "Cancellation failed",
        requestId: command.requestId,
      },
    };
  }
}

/**
 * Consume the canonical Payments refund observation for an order: only a
 * refunded payment finalizes CANCELLATION_REQUESTED into terminal CANCELED.
 */
export async function applyOrderRefundObservation(
  database: D1Database,
  input: { paymentIntentId: string },
): Promise<{ applied: boolean }> {
  const now = Date.now();
  const link = await database
    .prepare("SELECT order_id FROM order_payment_reaction WHERE payment_intent_id=?")
    .bind(input.paymentIntentId)
    .first<{ order_id: string }>();
  if (!link) return { applied: false };
  const applied = await database
    .prepare(
      "UPDATE grocery_order SET status='CANCELED', version=version+1 WHERE id=? AND status='CANCELLATION_REQUESTED'",
    )
    .bind(link.order_id)
    .run()
    .then((result) => (result.meta?.changes ?? 0) === 1);
  if (applied) await releaseOperationalEffects(database, link.order_id, now);
  return { applied };
}

function transitionOrderStatement(
  database: D1Database,
  orderId: string,
  fromStatus: string,
  toStatus: string,
  expectedVersion: number,
): D1PreparedStatement {
  return database
    .prepare(
      "UPDATE grocery_order SET status=?, version=version+1 WHERE id=? AND status=? AND version=?",
    )
    .bind(toStatus, orderId, fromStatus, expectedVersion);
}

function orderTransitionGuard(orderId: string, status: string, version: number) {
  return {
    clause: "EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status=? AND version=?)",
    binds: [orderId, status, version] as const,
  };
}

async function releaseOperationalEffects(
  database: D1Database,
  orderId: string,
  now: number,
): Promise<void> {
  await database.batch(releaseOperationalEffectStatements(database, orderId));
  void now;
}

function releaseOperationalEffectStatements(
  database: D1Database,
  orderId: string,
  guard?: { clause: string; binds: ReadonlyArray<unknown> },
): D1PreparedStatement[] {
  const guardClause = guard ? ` AND ${guard.clause}` : "";
  const guardBinds = guard?.binds ?? [];
  return [
    database
      .prepare(
        `UPDATE inventory_balance SET reserved=MAX(0,reserved-(SELECT COALESCE(SUM(quantity),0) FROM inventory_reservation r WHERE r.order_id=? AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id AND r.status='RESERVED')), version=version+1 WHERE EXISTS (SELECT 1 FROM inventory_reservation r WHERE r.order_id=? AND r.status='RESERVED' AND r.location_id=inventory_balance.location_id)${guardClause}`,
      )
      .bind(orderId, orderId, ...guardBinds),
    database
      .prepare(
        `UPDATE inventory_reservation SET status='RELEASED', version=version+1 WHERE order_id=? AND status='RESERVED'${guardClause}`,
      )
      .bind(orderId, ...guardBinds),
    database
      .prepare(
        `UPDATE committed_demand SET status='CANCELED', version=version+1 WHERE order_id=? AND status='OPEN'${guardClause}`,
      )
      .bind(orderId, ...guardBinds),
  ];
}

function assertLegalTransition(from: string, to: OrderLifecycleState): void {
  if (
    !orderLifecycleStates.includes(from as OrderLifecycleState) ||
    !canTransitionOrder(from as OrderLifecycleState, to)
  ) {
    throw httpError("ILLEGAL_TRANSITION", `Order cannot transition from ${from} to ${to}`);
  }
}

function completeScope(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
): Promise<unknown> {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, Date.now(), scope, key)
    .run();
}

function completeScopeStatement(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  guard: { clause: string; binds: ReadonlyArray<unknown> },
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
       WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${guard.clause}`,
    )
    .bind(reference, Date.now(), scope, key, ...guard.binds);
}

function httpError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
