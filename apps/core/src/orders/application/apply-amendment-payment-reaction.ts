import { isSufficientForCommitment } from "../../payments/domain/payment";
import type { PaymentDomainState } from "../../payments/domain/payment";

type PoolSourcing = "STOCKED" | "PLANNED" | "ON_DEMAND" | "MIXED";

export type ApplyAmendmentPaymentReactionInput = {
  reactionId: string;
  paymentIntentId: string;
  amendmentId: string;
  canonicalPaymentState: PaymentDomainState;
};

export type AmendmentReactionOutcome = {
  applied: boolean;
  reason:
    | "APPLIED"
    | "ALREADY_APPLIED"
    | "INSUFFICIENT_STATE"
    | "CAS_CONFLICT"
    | "SOURCING_UNAVAILABLE";
};

/**
 * Commit an additive amendment once its own payment intent reaches a
 * sufficient canonical state. Only amendment-scoped capacity/inventory deltas
 * are written; the original paid order's commercial history is untouched.
 */
export async function applyAmendmentPaymentReaction(
  database: D1Database,
  input: ApplyAmendmentPaymentReactionInput,
): Promise<AmendmentReactionOutcome> {
  const now = Date.now();
  if (!isSufficientForCommitment(input.canonicalPaymentState))
    return { applied: false, reason: "INSUFFICIENT_STATE" };

  const amendment = await database
    .prepare(
      `SELECT a.id, a.order_id, a.status, f.location_id, f.cycle_id, f.zone_id
       FROM paid_order_amendment a
       LEFT JOIN order_fulfillment_snapshot f ON f.order_id=a.order_id
       WHERE a.id=?`,
    )
    .bind(input.amendmentId)
    .first<{
      id: string;
      order_id: string;
      status: string;
      location_id: string | null;
      cycle_id: string | null;
      zone_id: string | null;
    }>();
  if (!amendment) return { applied: false, reason: "CAS_CONFLICT" };
  if (amendment.status === "COMMITTED") return { applied: true, reason: "ALREADY_APPLIED" };

  const lines = await database
    .prepare(
      `SELECT l.sku_id, l.quantity, l.base_quantity, p.inventory_pool_id AS pool_id,
              ip.canonical_sourcing_mode AS sourcing_mode
       FROM paid_order_amendment_line l JOIN sku s ON s.id=l.sku_id
       JOIN product p ON p.id=s.product_id JOIN inventory_pool ip ON ip.id=p.inventory_pool_id
       WHERE l.amendment_id=?`,
    )
    .bind(input.amendmentId)
    .all<{
      sku_id: string;
      quantity: number;
      base_quantity: number;
      pool_id: string;
      sourcing_mode: PoolSourcing;
    }>()
    .then((result) => result.results);

  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        "UPDATE paid_order_amendment SET status='COMMITTED', updated_at=? WHERE id=? AND status='PENDING_PAYMENT'",
      )
      .bind(now, input.amendmentId),
  ];

  const perPool = new Map<string, { requested: number; mode: PoolSourcing }>();
  for (const line of lines) {
    const entry =
      perPool.get(line.pool_id) ??
      ({ requested: 0, mode: line.sourcing_mode } satisfies {
        requested: number;
        mode: PoolSourcing;
      });
    entry.requested += line.base_quantity;
    perPool.set(line.pool_id, entry);
  }
  if ([...perPool.values()].some((plan) => plan.mode === "ON_DEMAND"))
    return { applied: false, reason: "SOURCING_UNAVAILABLE" };
  for (const [poolId, plan] of perPool) {
    const available =
      plan.mode === "PLANNED"
        ? 0
        : ((
            await database
              .prepare(
                "SELECT MAX(0, on_hand-reserved) AS available FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
              )
              .bind(amendment.location_id ?? "", poolId)
              .first<{ available: number | null }>()
          )?.available ?? 0);
    const reserved = plan.mode === "STOCKED" ? plan.requested : Math.min(plan.requested, available);
    const planned = plan.requested - reserved;
    if (reserved > 0) {
      statements.push(
        database
          .prepare(
            "UPDATE inventory_balance SET reserved=reserved+?, version=version+1 WHERE location_id=? AND inventory_pool_id=? AND on_hand-reserved>=?",
          )
          .bind(reserved, amendment.location_id ?? "", poolId, reserved),
        database
          .prepare(
            "INSERT INTO inventory_reservation (id, order_id, location_id, inventory_pool_id, quantity, status) SELECT ?, ?, ?, ?, ?, 'RESERVED' WHERE changes()=1",
          )
          .bind(
            crypto.randomUUID(),
            `${amendment.order_id}`,
            amendment.location_id ?? "",
            poolId,
            reserved,
          ),
      );
    }
    if (planned > 0) {
      statements.push(
        database
          .prepare(
            "INSERT INTO committed_demand (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status) VALUES (?, ?, ?, ?, ?, ?, 'OPEN')",
          )
          .bind(
            crypto.randomUUID(),
            `${amendment.order_id}`,
            amendment.cycle_id ?? "",
            amendment.location_id ?? "",
            poolId,
            planned,
          ),
      );
    }
  }
  void isSufficientForCommitment;

  try {
    await database.batch(statements);
    return { applied: true, reason: "APPLIED" };
  } catch {
    // Concurrent change: the PENDING_PAYMENT guard loses the race.
    return { applied: false, reason: "CAS_CONFLICT" };
  }
}
