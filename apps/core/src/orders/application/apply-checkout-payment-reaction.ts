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
  const routingSnapshot = quote.cycleSnapshot as CycleSnapshot | null;
  const instant = quote.fulfillmentMode === "INSTANT";
  if (!instant) {
    if (!routingSnapshot || Date.parse(routingSnapshot.cutoffAt) <= now)
      return recordException(database, input, "CYCLE_CLOSED", "QUOTE_UNUSABLE");
  } else if (!routingSnapshot)
    return recordException(database, input, "CYCLE_CLOSED", "QUOTE_UNUSABLE");
  const cycleSnapshot = routingSnapshot;

  const fulfillment = quote.fulfillmentSnapshot as {
    sourcingModes: Array<"STOCKED" | "PLANNED" | "ON_DEMAND" | "MIXED">;
    poolIds: string[];
  } | null;

  // Per-pool requested base units and sourcing split (approved planner rules).
  type PoolPlan = {
    poolId: string;
    requestedBase: number;
    sourcingMode: "STOCKED" | "PLANNED" | "ON_DEMAND" | "MIXED";
    availableBase: number;
  };
  const pools = new Map<string, PoolPlan>();
  for (const line of quote.lines) {
    const skuPool = await database
      .prepare(
        "SELECT p.inventory_pool_id AS pool_id, ip.canonical_sourcing_mode AS sourcing_mode FROM sku s JOIN product p ON p.id=s.product_id JOIN inventory_pool ip ON ip.id=p.inventory_pool_id WHERE s.id=?",
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
  if ([...pools.values()].some((plan) => plan.sourcingMode === "ON_DEMAND"))
    return recordException(database, input, "SOURCING_MODE_UNAVAILABLE", "QUOTE_UNUSABLE");
  for (const plan of pools.values()) {
    if (plan.sourcingMode === "PLANNED") continue;
    const balance = await database
      .prepare(
        "SELECT MAX(0, on_hand-reserved) AS available FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
      )
      .bind(cycleSnapshot.locationId, plan.poolId)
      .first<{ available: number | null }>();
    plan.availableBase = Math.max(0, balance?.available ?? 0);
  }

  const orderId = crypto.randomUUID();
  const deliveryJobId = crypto.randomUUID();
  const deliveryStopId = crypto.randomUUID();
  const addressSnapshot = (quote.addressSnapshot ?? {}) as Record<string, unknown>;
  const addressSnapshotJson = JSON.stringify(addressSnapshot);
  const latitude = typeof addressSnapshot.latitude === "number" ? addressSnapshot.latitude : null;
  const longitude =
    typeof addressSnapshot.longitude === "number" ? addressSnapshot.longitude : null;
  const contactSnapshotJson = JSON.stringify({
    recipient: typeof addressSnapshot.recipient === "string" ? addressSnapshot.recipient : null,
    phone: typeof addressSnapshot.phone === "string" ? addressSnapshot.phone : null,
  });
  const instructionsSnapshot = deliveryInstructionsSnapshot(addressSnapshot);
  const promisedAt = instant
    ? Date.parse(
        (fulfillment as { promisedAt?: string } | null)?.promisedAt ?? new Date(now).toISOString(),
      )
    : null;
  const statements: D1PreparedStatement[] = [
    // Unique payment-intent identity claims the entire commitment.
    database
      .prepare(
        "INSERT INTO order_payment_reaction (id, payment_intent_id, reaction_id, order_id, applied_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), input.paymentIntentId, input.reactionId, orderId, now),
    database
      .prepare(
        "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, created_at) SELECT ?, ?, ?, ?, ?, 'COMMITTED', ?, ?, pa.id, ? FROM payment_attempt pa WHERE pa.payment_intent_id=? AND pa.status='SUCCEEDED' ORDER BY pa.created_at ASC LIMIT 1",
      )
      .bind(
        orderId,
        quote.customerId,
        instant ? null : quote.deliveryCycleId,
        instant ? "INSTANT" : "SCHEDULED",
        addressSnapshotJson,
        quote.totalMinor,
        quote.currency,
        now,
        input.paymentIntentId,
      ),
    instant
      ? database
          .prepare(
            "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at, fulfillment_mode, sourcing_modes_json, delivery_fee_snapshot_json, created_at) VALUES (?, ?, NULL, ?, NULL, NULL, ?, 'INSTANT', ?, ?, ?)",
          )
          .bind(
            orderId,
            cycleSnapshot.locationId,
            cycleSnapshot.zoneId,
            promisedAt,
            JSON.stringify(fulfillment?.sourcingModes ?? []),
            JSON.stringify(quote.deliveryFeeSnapshot),
            now,
          )
      : database
          .prepare(
            "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at, fulfillment_mode, sourcing_modes_json, delivery_fee_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'SCHEDULED', ?, ?, ?)",
          )
          .bind(
            orderId,
            cycleSnapshot.locationId,
            cycleSnapshot.cycleId,
            cycleSnapshot.zoneId,
            Date.parse(cycleSnapshot.cutoffAt),
            Date.parse(cycleSnapshot.cutoffAt),
            JSON.stringify(fulfillment?.sourcingModes ?? []),
            JSON.stringify(quote.deliveryFeeSnapshot),
            now,
          ),
    // Operational lifecycle records begin here: fulfillment is queued for
    // picking and the delivery job starts UNASSIGNED until a
    // scoped assignment command names its rider.
    database
      .prepare(
        "INSERT INTO fulfillment_record (id, order_id, location_id, status, updated_at) VALUES (?, ?, ?, 'NOT_STARTED', ?)",
      )
      .bind(crypto.randomUUID(), orderId, cycleSnapshot.locationId, now),
    database
      .prepare(
        "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, promised_at, rider_user_id, status, address_snapshot_json, delivered_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'UNASSIGNED', ?, NULL, ?, ?)",
      )
      .bind(
        deliveryJobId,
        orderId,
        instant ? null : quote.deliveryCycleId,
        instant ? "INSTANT" : "SCHEDULED",
        cycleSnapshot.locationId,
        cycleSnapshot.zoneId,
        promisedAt,
        addressSnapshotJson,
        now,
        now,
      ),
    database
      .prepare(
        "INSERT INTO delivery_stop (id, delivery_job_id, batch_id, sequence, latitude, longitude, address_snapshot_json, contact_snapshot_json, instructions_snapshot, status, proof_json, arrived_at, delivered_at, failure_reason_code, failure_notes, version, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'UNASSIGNED', NULL, NULL, NULL, NULL, NULL, 1, ?, ?)",
      )
      .bind(
        deliveryStopId,
        deliveryJobId,
        latitude,
        longitude,
        addressSnapshotJson,
        contactSnapshotJson,
        instructionsSnapshot,
        now,
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

  // Instant commitments convert their expiring holds and respect the
  // location's concurrent-order capacity instead of cycle capacity.
  let maxConcurrentInstantOrders: number | null = null;
  if (instant) {
    const mode = await database
      .prepare(
        "SELECT max_concurrent_instant_orders FROM fulfillment_location_mode WHERE location_id=? AND active_mode='INSTANT'",
      )
      .bind(cycleSnapshot.locationId)
      .first<{ max_concurrent_instant_orders: number | null }>();
    if (!mode || mode.max_concurrent_instant_orders === null)
      return recordException(database, input, "INSTANT_MODE_UNAVAILABLE", "QUOTE_UNUSABLE");
    maxConcurrentInstantOrders = mode.max_concurrent_instant_orders;
    statements.push(
      database
        .prepare(
          "UPDATE checkout_inventory_holds SET status='COMMITTED', updated_at=? WHERE checkout_attempt_id=? AND status='HELD'",
        )
        .bind(now, quote.id),
    );
  }

  for (const plan of pools.values()) {
    let reservedBase = 0;
    let plannedBase = 0;
    if (plan.sourcingMode === "STOCKED") {
      reservedBase = plan.requestedBase;
    } else if (plan.sourcingMode === "PLANNED") {
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
        : plan.sourcingMode === "MIXED"
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
  );
  if (instant && maxConcurrentInstantOrders !== null) {
    // Capacity abort sentinel: too many open instant orders rolls the whole
    // commitment back into a finance exception.
    statements.push(
      database
        .prepare(
          `INSERT INTO commitment_abort (id) SELECT -2 WHERE (
            SELECT COUNT(*) FROM grocery_order go
            JOIN order_fulfillment_snapshot s ON s.order_id = go.id
            WHERE s.location_id=? AND s.fulfillment_mode='INSTANT' AND go.status NOT IN ('CANCELED','REFUNDED')
          ) > ?`,
        )
        .bind(cycleSnapshot.locationId, maxConcurrentInstantOrders),
    );
  }
  statements.push(
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

function deliveryInstructionsSnapshot(addressSnapshot: Record<string, unknown>): string | null {
  const structured = addressSnapshot.delivery_instructions_json;
  if (typeof structured === "string") return structured;
  if (structured !== null && typeof structured === "object") return JSON.stringify(structured);
  const notes = addressSnapshot.notes;
  return typeof notes === "string" ? JSON.stringify({ deliveryNote: notes }) : null;
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
  kind:
    | "QUOTE_EXPIRED"
    | "MEMBERSHIP_LOST"
    | "CYCLE_CLOSED"
    | "INSTANT_MODE_UNAVAILABLE"
    | "SOURCING_MODE_UNAVAILABLE",
  reason: OrderCommittedOutcome["reason"],
): Promise<OrderCommittedOutcome> {
  await recordFinanceExceptionRow(database, input, kind, reason, Date.now());
  return { applied: false, reason };
}
