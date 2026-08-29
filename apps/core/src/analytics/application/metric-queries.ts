import type {
  AnalyticsDimension,
  AnalyticsFreshness,
  AnalyticsSeriesPoint,
  AnalyticsWindow,
  MetricDefinitionView,
  Scope,
} from "@freshmarkets/contracts";
import type { AnalyticsQueryKey } from "../metric-catalog";

export type MetricQueryInput = {
  database: D1Database;
  queryKey: AnalyticsQueryKey;
  definition: MetricDefinitionView;
  window: AnalyticsWindow;
  scope: Scope;
  dimensions: ReadonlyArray<AnalyticsDimension>;
  computedAt: number;
};

export type MetricQueryResult = {
  availability: "AVAILABLE" | "UNAVAILABLE";
  unavailableReason: string | null;
  points: ReadonlyArray<AnalyticsSeriesPoint>;
  freshness: AnalyticsFreshness;
};

type ScalarRow = { value: number | null; watermark: number | null };

const INSTRUMENTATION_UNAVAILABLE: Partial<Record<AnalyticsQueryKey, string>> = {
  refundAmount:
    "Unavailable because canonical refund success timestamps are not yet instrumented.",
  discountSpend:
    "Unavailable because committed promotion-component snapshots are not yet instrumented.",
  promotionInfluencedOrderRevenue:
    "Unavailable because committed Order promotion-redemption linkage is not yet instrumented.",
  fulfillmentTime:
    "Unavailable because fulfillment completion timestamps are not yet instrumented.",
  pickingTime: "Unavailable because picking start/completion timestamps are not yet instrumented.",
  packingTime: "Unavailable because packing start/completion timestamps are not yet instrumented.",
  deliveryTime: "Unavailable because delivery dispatch timestamps are not yet instrumented.",
  lateDeliveryRate:
    "Unavailable because complete promised-time and delivery lifecycle instrumentation is not yet available.",
  outOfStockRate:
    "Unavailable because availability-evaluation instrumentation is not yet available.",
  stockouts: "Unavailable because usable-stock transition deduplication is not yet instrumented.",
};

function instant(value: number): string {
  return new Date(value).toISOString();
}

function unavailable(reason: string, computedAt: number): MetricQueryResult {
  return {
    availability: "UNAVAILABLE",
    unavailableReason: reason,
    points: [],
    freshness: { sourceWatermark: null, computedAt: instant(computedAt) },
  };
}

function scopePredicate(scope: Scope, alias = "snapshot"): { clause: string; binds: string[] } {
  if (scope.kind === "global") return { clause: "", binds: [] };
  if (scope.kind === "location")
    return { clause: ` AND ${alias}.location_id = ?`, binds: [scope.locationId] };
  return {
    clause: ` AND ${alias}.location_id IN (SELECT id FROM fulfillment_location WHERE market_id = ?)`,
    binds: [scope.marketId],
  };
}

function selectedDimension(
  dimensions: ReadonlyArray<AnalyticsDimension>,
  key: string,
): string | null {
  return dimensions.find((dimension) => dimension.key === key)?.value ?? null;
}

async function scalar(
  database: D1Database,
  sql: string,
  binds: ReadonlyArray<unknown>,
): Promise<ScalarRow> {
  return (
    (await database
      .prepare(sql)
      .bind(...binds)
      .first<ScalarRow>()) ?? { value: 0, watermark: null }
  );
}

function available(row: ScalarRow, window: AnalyticsWindow, computedAt: number): MetricQueryResult {
  return {
    availability: "AVAILABLE",
    unavailableReason: null,
    points: [{ occurredAt: window.endAt, value: row.value }],
    freshness: {
      sourceWatermark: row.watermark === null ? null : instant(row.watermark),
      computedAt: instant(computedAt),
    },
  };
}

/** Executes only closed, persisted-definition-selected SQL read models. */
export async function executeMetricQuery(input: MetricQueryInput): Promise<MetricQueryResult> {
  const blockedForInstrumentation = INSTRUMENTATION_UNAVAILABLE[input.queryKey];
  if (blockedForInstrumentation) return unavailable(blockedForInstrumentation, input.computedAt);
  const start = Date.parse(input.window.startAt);
  const end = Date.parse(input.window.endAt);
  const scope = scopePredicate(input.scope);
  const scopedOrderJoin = `
    FROM grocery_order orders
    JOIN order_payment_reaction reaction ON reaction.order_id = orders.id
    JOIN payment_intent payment ON payment.id = reaction.payment_intent_id AND payment.status = 'SUCCEEDED'
    JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = orders.id
    WHERE reaction.applied_at >= ? AND reaction.applied_at < ?${scope.clause}`;
  const orderBinds = [start, end, ...scope.binds];

  switch (input.queryKey) {
    case "orderCount":
      return available(
        await scalar(
          input.database,
          `SELECT COUNT(*) AS value, MAX(reaction.applied_at) AS watermark ${scopedOrderJoin}`,
          orderBinds,
        ),
        input.window,
        input.computedAt,
      );
    case "activeCustomers":
      return available(
        await scalar(
          input.database,
          `SELECT COUNT(DISTINCT orders.customer_id) AS value, MAX(reaction.applied_at) AS watermark ${scopedOrderJoin}`,
          orderBinds,
        ),
        input.window,
        input.computedAt,
      );
    case "repeatCustomerRate": {
      const row = await scalar(
        input.database,
        `SELECT CASE WHEN COUNT(DISTINCT orders.customer_id) = 0 THEN NULL
                ELSE CAST(COUNT(DISTINCT CASE WHEN EXISTS (
                  SELECT 1 FROM grocery_order prior_orders
                  JOIN order_payment_reaction prior_reaction ON prior_reaction.order_id = prior_orders.id
                  JOIN payment_intent prior_payment ON prior_payment.id = prior_reaction.payment_intent_id AND prior_payment.status='SUCCEEDED'
                  WHERE prior_orders.customer_id = orders.customer_id AND prior_reaction.applied_at < reaction.applied_at
                ) THEN orders.customer_id END) AS REAL) / COUNT(DISTINCT orders.customer_id) END AS value,
                MAX(reaction.applied_at) AS watermark ${scopedOrderJoin}`,
        orderBinds,
      );
      return available(row, input.window, input.computedAt);
    }
    case "ordersPerCustomer": {
      const row = await scalar(
        input.database,
        `SELECT CASE WHEN COUNT(DISTINCT orders.customer_id) = 0 THEN NULL
                ELSE CAST(COUNT(*) AS REAL) / COUNT(DISTINCT orders.customer_id) END AS value,
                MAX(reaction.applied_at) AS watermark ${scopedOrderJoin}`,
        orderBinds,
      );
      return available(row, input.window, input.computedAt);
    }
    case "newCustomers":
      if (input.scope.kind !== "global")
        return unavailable(
          "Unavailable because Customer creation has no market/location attribution.",
          input.computedAt,
        );
      return available(
        await scalar(
          input.database,
          "SELECT COUNT(*) AS value, MAX(created_at) AS watermark FROM customer WHERE created_at >= ? AND created_at < ?",
          [start, end],
        ),
        input.window,
        input.computedAt,
      );
    case "refundAmount": {
      const currency = selectedDimension(input.dimensions, "currency");
      const refundScope = scopePredicate(input.scope);
      const currencyClause = currency ? " AND refund.currency = ?" : "";
      return available(
        await scalar(
          input.database,
          `SELECT COALESCE(SUM(refund.amount_minor), 0) AS value, MAX(refund.updated_at) AS watermark
           FROM payment_refund refund
           JOIN payment_intent payment ON payment.id = refund.payment_intent_id
           LEFT JOIN grocery_order orders ON orders.id = payment.subject_id AND payment.subject_type = 'order'
           LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = orders.id
           WHERE refund.status='SUCCEEDED' AND refund.updated_at >= ? AND refund.updated_at < ?${currencyClause}${refundScope.clause}`,
          [start, end, ...(currency ? [currency] : []), ...refundScope.binds],
        ),
        input.window,
        input.computedAt,
      );
    }
    case "activeMembers":
    case "trialingMembers": {
      if (input.scope.kind !== "global")
        return unavailable(
          "Unavailable because subscription state has no market/location attribution.",
          input.computedAt,
        );
      const status = input.queryKey === "activeMembers" ? "ACTIVE" : "TRIALING";
      return available(
        await scalar(
          input.database,
          "SELECT COUNT(*) AS value, MAX(updated_at) AS watermark FROM subscription WHERE status=? AND starts_at <= ? AND (ended_at IS NULL OR ended_at > ?)",
          [status, end, end],
        ),
        input.window,
        input.computedAt,
      );
    }
    case "promotionRedemptions": {
      if (input.scope.kind !== "global")
        return unavailable(
          "Unavailable because promotion redemptions have no market/location attribution.",
          input.computedAt,
        );
      const benefitType = selectedDimension(input.dimensions, "promotionBenefitType");
      const promotionId = selectedDimension(input.dimensions, "promotionId");
      const promotionClause = promotionId ? " AND promotion.id = ?" : "";
      return available(
        await scalar(
          input.database,
          `SELECT COUNT(*) AS value, MAX(redeemed_at) AS watermark FROM promotion_redemption
           LEFT JOIN promotion ON promotion.code = promotion_redemption.benefit_code
           WHERE redeemed_at >= ? AND redeemed_at < ?${benefitType ? " AND benefit_type = ?" : ""}${promotionClause}`,
          [start, end, ...(benefitType ? [benefitType] : []), ...(promotionId ? [promotionId] : [])],
        ),
        input.window,
        input.computedAt,
      );
    }
    case "cancellationRate": {
      const row = await scalar(
        input.database,
        `SELECT CASE WHEN COUNT(*) = 0 THEN NULL
                ELSE CAST(SUM(CASE WHEN orders.status='CANCELED' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) END AS value,
                MAX(reaction.applied_at) AS watermark ${scopedOrderJoin}`,
        orderBinds,
      );
      return available(row, input.window, input.computedAt);
    }
    case "inventoryAdjustmentsShrinkage": {
      const adjustmentScope = scopePredicate(input.scope, "ledger");
      const baseUnit = selectedDimension(input.dimensions, "baseUnit");
      return available(
        await scalar(
          input.database,
          `SELECT COALESCE(SUM(ledger.quantity_delta_base), 0) AS value, MAX(ledger.created_at) AS watermark
           FROM inventory_ledger_entries ledger
           JOIN inventory_pool pool ON pool.id=ledger.inventory_pool_id
           JOIN unit base_unit ON base_unit.id=pool.base_unit_id
           WHERE ledger.movement_type='ADJUSTMENT' AND ledger.created_at >= ? AND ledger.created_at < ?
             ${baseUnit ? "AND base_unit.code = ?" : ""}${adjustmentScope.clause}`,
          [start, end, ...(baseUnit ? [baseUnit] : []), ...adjustmentScope.binds],
        ),
        input.window,
        input.computedAt,
      );
    }
  }
  return unavailable("Metric query is not available.", input.computedAt);
}
