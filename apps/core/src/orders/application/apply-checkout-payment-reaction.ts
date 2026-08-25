import { isSufficientForCommitment } from "../../payments/domain/payment";
import type { PaymentDomainState } from "../../payments/domain/payment";
import { createCheckoutRepository } from "../../checkout/infrastructure/d1-checkout-repository";

export type ApplyCheckoutPaymentReactionInput = {
  reactionId: string;
  paymentIntentId: string;
  checkoutAttemptId: string;
  canonicalPaymentState: PaymentDomainState;
};

export type OrderCommittedOutcome = {
  applied: boolean;
  reason:
    | "APPLIED"
    | "ALREADY_APPLIED"
    | "INSUFFICIENT_STATE"
    | "QUOTE_UNUSABLE"
    | "MEMBERSHIP_LOST"
    | "CAS_CONFLICT";
  orderId?: string;
};

/**
 * Orders side of the canonical Payments reaction contract. Only a
 * provider-confirmed state sufficient under the commitment policy may create
 * the paid order. Reaction identity is the unique claim; quote consumption,
 * order and snapshots, capacity, and stocked-reservation vs planned-demand
 * effects commit in one D1 batch so duplicates can never double-commit and a
 * lost race leaves durable retry/reconciliation state instead of partials.
 */
export async function applyCheckoutPaymentReaction(
  database: D1Database,
  input: ApplyCheckoutPaymentReactionInput,
): Promise<OrderCommittedOutcome> {
  const now = Date.now();

  const existing = await database
    .prepare("SELECT status FROM payment_reaction WHERE id=?")
    .bind(input.reactionId)
    .first<{ status: string }>();
  if (!existing) return { applied: false, reason: "INSUFFICIENT_STATE" };

  const already = await database
    .prepare("SELECT order_id FROM order_payment_reaction WHERE reaction_id=?")
    .bind(input.reactionId)
    .first<{ order_id: string }>();
  if (already) return { applied: true, reason: "ALREADY_APPLIED", orderId: already.order_id };

  if (!isSufficientForCommitment(input.canonicalPaymentState))
    return { applied: false, reason: "INSUFFICIENT_STATE" };

  const repository = createCheckoutRepository(database);
  const quote = await repository.findQuoteById(input.checkoutAttemptId);
  if (!quote || quote.status !== "ACTIVE" || quote.expiresAt <= now)
    return recordException(database, input, "QUOTE_EXPIRED", "QUOTE_UNUSABLE");

  // Membership must still be entitled at the commitment boundary.
  const membership = await database
    .prepare(
      "SELECT status FROM subscription WHERE customer_id=? AND status IN ('TRIALING','ACTIVE') LIMIT 1",
    )
    .bind(quote.customerId)
    .first<{ status: string }>();
  if (!membership) return recordException(database, input, "MEMBERSHIP_LOST", "MEMBERSHIP_LOST");

  interface CycleSnapshot {
    cycleId: string;
    cutoffAt: string;
    zoneId: string;
    locationId: string;
    locationName: string;
    [key: string]: unknown;
  }
  const cycleSnapshot = quote.cycleSnapshot as CycleSnapshot | null;
  if (!cycleSnapshot || Date.parse(cycleSnapshot.cutoffAt) <= now)
    return recordException(database, input, "CYCLE_CLOSED", "QUOTE_UNUSABLE");

  const fulfillment = quote.fulfillmentSnapshot as {
    sourcingModes: Array<"STOCKED" | "PLANNED_PROCUREMENT" | "HYBRID">;
    poolIds: string[];
  } | null;

  // Per-pool requested base units and sourcing split (approved planner rules).
  type PoolPlan = {
    poolId: string;
    requestedBase: number;
    sourcingMode: "STOCKED" | "PLANNED_PROCUREMENT" | "HYBRID";
    availableBase: number;
  };
  const pools = new Map<string, PoolPlan>();
  for (const line of quote.lines) {
    const skuPool = await database
      .prepare(
        "SELECT p.inventory_pool_id AS pool_id, ip.sourcing_mode AS sourcing_mode FROM sku s JOIN product p ON p.id=s.product_id JOIN inventory_pool ip ON ip.id=p.inventory_pool_id WHERE s.id=?",
      )
      .bind(line.skuId)
      .first<{ pool_id: string; sourcing_mode: PoolPlan["sourcingMode"] }>();
    if (!skuPool) continue;
    const plan =
      pools.get(skuPool.pool_id) ??
      ({
        poolId: skuPool.pool_id,
        requestedBase: 0,
        sourcingMode: skuPool.sourcing_mode,
        availableBase: 0,
      } satisfies PoolPlan);
    plan.requestedBase += line.baseQuantity;
    pools.set(skuPool.pool_id, plan);
  }
  for (const plan of pools.values()) {
    if (plan.sourcingMode === "PLANNED_PROCUREMENT") continue;
    const balance = await database
      .prepare(
        "SELECT MAX(0, on_hand-reserved) AS available FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
      )
      .bind(cycleSnapshot.locationId, plan.poolId)
      .first<{ available: number | null }>();
    plan.availableBase = Math.max(0, balance?.available ?? 0);
  }

  const orderId = crypto.randomUUID();
  const paymentAttemptId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    // Unique payment-intent identity claims the entire commitment.
    database
      .prepare(
        "INSERT INTO order_payment_reaction (id, payment_intent_id, reaction_id, order_id, applied_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), input.paymentIntentId, input.reactionId, orderId, now),
    database
      .prepare(
        "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) SELECT ?, customer_id, id, amount_minor, currency, 'SUCCEEDED', 'canonical', ?, ?, ? FROM payment_intent WHERE id=?",
      )
      .bind(paymentAttemptId, `intent:${input.paymentIntentId}`, now, now, input.paymentIntentId),
    database
      .prepare(
        "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at) VALUES (?, ?, ?, ?, 'COMMITTED', ?, ?, ?, ?)",
      )
      .bind(
        orderId,
        quote.customerId,
        quote.deliveryCycleId,
        JSON.stringify(quote.addressSnapshot),
        quote.totalMinor,
        quote.currency,
        paymentAttemptId,
        now,
      ),
    database
      .prepare(
        "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, fulfillment_mode, sourcing_modes_json, created_at) VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?)",
      )
      .bind(
        orderId,
        cycleSnapshot.locationId,
        cycleSnapshot.cycleId,
        cycleSnapshot.zoneId,
        Date.parse(cycleSnapshot.cutoffAt),
        Date.parse(cycleSnapshot.cutoffAt),
        JSON.stringify(fulfillment?.sourcingModes ?? []),
        now,
      ),
    database
      .prepare(
        "UPDATE checkout_quote SET status='CONSUMED', version=version+1, updated_at=? WHERE id=? AND version=? AND status='ACTIVE'",
      )
      .bind(now, quote.id, quote.version),
    ...quote.lines.map((line) =>
      database
        .prepare(
          "INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          orderId,
          line.skuId,
          line.productName,
          line.variantName,
          line.unit,
          line.quantity,
          line.unitPriceMinor,
          line.lineTotalMinor,
          line.baseQuantity,
        ),
    ),
    database
      .prepare(
        "UPDATE cycle_zone_capacity SET allocated=allocated+1, version=version+1 WHERE cycle_id=? AND zone_id=? AND location_id=? AND allocated < capacity",
      )
      .bind(quote.deliveryCycleId, cycleSnapshot.zoneId, cycleSnapshot.locationId),
  ];

  for (const plan of pools.values()) {
    let reservedBase = 0;
    let plannedBase = 0;
    if (plan.sourcingMode === "STOCKED") {
      reservedBase = plan.requestedBase;
    } else if (plan.sourcingMode === "PLANNED_PROCUREMENT") {
      plannedBase = plan.requestedBase;
    } else {
      reservedBase = Math.min(plan.requestedBase, plan.availableBase);
      plannedBase = plan.requestedBase - reservedBase;
    }
    if (reservedBase > 0) {
      statements.push(
        database
          .prepare(
            "UPDATE inventory_balance SET reserved=reserved+?, version=version+1 WHERE location_id=? AND inventory_pool_id=? AND on_hand-reserved>=?",
          )
          .bind(reservedBase, cycleSnapshot.locationId, plan.poolId, reservedBase),
        database
          .prepare(
            "INSERT INTO inventory_reservation (id, order_id, location_id, inventory_pool_id, quantity, status) SELECT ?, ?, ?, ?, ?, 'RESERVED' WHERE changes()=1",
          )
          .bind(crypto.randomUUID(), orderId, cycleSnapshot.locationId, plan.poolId, reservedBase),
        database
          .prepare(
            "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, reason_code, metadata_json, created_at, idempotency_key) SELECT ?, ?, ?, 'CHECKOUT_HOLD', 0, ?, 'grocery_order', ?, 'CUSTOMER', 'CHECKOUT_COMMIT', '{}', ?, ? WHERE changes()=1",
          )
          .bind(
            crypto.randomUUID(),
            plan.poolId,
            cycleSnapshot.locationId,
            reservedBase,
            orderId,
            now,
            input.reactionId,
          ),
      );
    }
    if (plannedBase > 0) {
      statements.push(
        database
          .prepare(
            "INSERT INTO committed_demand (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status) VALUES (?, ?, ?, ?, ?, ?, 'OPEN')",
          )
          .bind(
            crypto.randomUUID(),
            orderId,
            quote.deliveryCycleId,
            cycleSnapshot.locationId,
            plan.poolId,
            plannedBase,
          ),
      );
    }
  }

  // Hard-abort sentinel: when any guarded reservation failed to land, the
  // mismatching count forces a CHECK violation that rolls back the entire
  // commitment transaction.
  const expectedReservationRows = [...pools.values()].filter((plan) => {
    const reserved =
      plan.sourcingMode === "STOCKED"
        ? plan.requestedBase
        : plan.sourcingMode === "HYBRID"
          ? Math.min(plan.requestedBase, plan.availableBase)
          : 0;
    return reserved > 0;
  }).length;
  statements.push(
    database
      .prepare(
        "INSERT INTO commitment_abort (id) SELECT -1 WHERE ? > 0 AND (SELECT COUNT(*) FROM inventory_reservation WHERE order_id=?) != ?",
      )
      .bind(expectedReservationRows, orderId, expectedReservationRows),
    database
      .prepare(
        "UPDATE payment_reaction SET status='SUCCEEDED', attempts=attempts+1, updated_at=? WHERE id=?",
      )
      .bind(now, input.reactionId),
  );

  try {
    const results = await database.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) !== 1) throw new Error("REACTION_RACE");
    return { applied: true, reason: "APPLIED", orderId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const winner = await database
      .prepare("SELECT order_id FROM order_payment_reaction WHERE payment_intent_id=?")
      .bind(input.paymentIntentId)
      .first<{ order_id: string }>();
    if (winner) return { applied: true, reason: "ALREADY_APPLIED", orderId: winner.order_id };
    if (
      message.includes("CHECK constraint failed") ||
      message.includes("on_hand-reserved") ||
      message.includes("capacity")
    ) {
      await database
        .prepare(
          "INSERT INTO finance_exception (id, kind, payment_intent_id, reaction_id, details_json, attempts, last_error_code, status, created_at) VALUES ('stock' || lower(hex(randomblob(12))), 'STOCK_UNAVAILABLE', ?, ?, '{}', 1, ?, 'OPEN', ?)",
        )
        .bind(input.paymentIntentId, input.reactionId, message.slice(0, 120), now)
        .run()
        .catch(() => undefined);
      return { applied: false, reason: "CAS_CONFLICT" };
    }
    await recordFinanceExceptionRow(database, input, "TRANSIENT_FAILURE", message, now);
    return { applied: false, reason: "CAS_CONFLICT" };
  }
}

async function recordFinanceExceptionRow(
  database: D1Database,
  input: ApplyCheckoutPaymentReactionInput,
  kind: string,
  errorCode: string,
  now: number,
): Promise<void> {
  await database
    .prepare(
      "INSERT OR IGNORE INTO finance_exception (id, kind, payment_intent_id, reaction_id, details_json, attempts, last_error_code, status, created_at) VALUES (?, ?, ?, ?, '{}', 1, ?, 'OPEN', ?)",
    )
    .bind(
      crypto.randomUUID(),
      kind,
      input.paymentIntentId,
      input.reactionId,
      errorCode.slice(0, 120),
      now,
    )
    .run()
    .catch(() => undefined);
}

async function recordException(
  database: D1Database,
  input: ApplyCheckoutPaymentReactionInput,
  kind: "QUOTE_EXPIRED" | "MEMBERSHIP_LOST" | "CYCLE_CLOSED",
  reason: OrderCommittedOutcome["reason"],
): Promise<OrderCommittedOutcome> {
  await recordFinanceExceptionRow(database, input, kind, reason, Date.now());
  return { applied: false, reason };
}
