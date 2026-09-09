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
  dimensions: ReadonlyArray<AnalyticsDimension>;
};

type ScalarRow = { value: number | null; watermark: number | null; missingAttribution?: number };

function instant(value: number): string {
  return new Date(value).toISOString();
}

function unavailable(reason: string, computedAt: number): MetricQueryResult {
  return {
    availability: "UNAVAILABLE",
    unavailableReason: reason,
    points: [],
    freshness: { sourceWatermark: null, computedAt: instant(computedAt) },
    dimensions: [],
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

/** Keep unattributed facts visible as unavailable instead of silently dropping them. */
function reportScope(scope: Scope) {
  const filter = scopePredicate(scope);
  return {
    binds: filter.binds,
    clause:
      scope.kind === "global" ? "" : ` AND (snapshot.location_id IS NULL OR (1=1${filter.clause}))`,
    missing: scope.kind === "global" ? "0" : "COUNT(CASE WHEN location_id IS NULL THEN 1 END)",
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
  if (row.value !== null && !Number.isSafeInteger(row.value))
    return unavailable("This total exceeds the supported exact numeric range.", computedAt);
  if (row.missingAttribution)
    return unavailable(
      "Retained Orders lack the location evidence needed for this scoped report.",
      computedAt,
    );
  return {
    availability: "AVAILABLE",
    unavailableReason: null,
    points: [{ occurredAt: window.endAt, value: row.value }],
    freshness: {
      sourceWatermark: row.watermark === null ? null : instant(row.watermark),
      computedAt: instant(computedAt),
    },
    dimensions: [],
  };
}

/** Executes only closed, persisted-definition-selected SQL read models. */
export async function executeMetricQuery(input: MetricQueryInput): Promise<MetricQueryResult> {
  const start = Date.parse(input.window.startAt);
  const end = Date.parse(input.window.endAt);
  const scope = reportScope(input.scope);
  const scopedOrderJoin = `
    FROM grocery_order orders
    JOIN order_payment_reaction reaction ON reaction.order_id = orders.id
    LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = orders.id
    WHERE reaction.applied_at >= ? AND reaction.applied_at < ?${scope.clause}`;
  const orderBinds = [start, end, ...scope.binds];
  // A purchase remains a purchase after cancellation/refund. Use the immutable
  // commitment, and break equal timestamps by Order identity exactly once.
  const priorPurchase = `EXISTS (
    SELECT 1 FROM grocery_order prior_orders
    JOIN order_payment_reaction prior_reaction ON prior_reaction.order_id=prior_orders.id
    WHERE prior_orders.customer_id=orders.customer_id AND
      (prior_reaction.applied_at<reaction.applied_at OR
       (prior_reaction.applied_at=reaction.applied_at AND prior_orders.id<orders.id))
  )`;

  switch (input.queryKey) {
    case "deliveredOrders":
    case "canceledOrders":
      return orderEvents(input);
    case "paidProductQuantity":
    case "canceledProductQuantity":
      return productQuantity(input);
    case "deliveryCharges":
    case "deliveryCosts":
      return deliveryMoney(input);
    case "discountSpend":
      return committedPromotions(input);
    case "orderCount":
      return available(
        await scalar(
          input.database,
          `SELECT COUNT(*) AS value, MAX(reaction.applied_at) AS watermark, ${scope.missing} AS missingAttribution ${scopedOrderJoin}`,
          orderBinds,
        ),
        input.window,
        input.computedAt,
      );
    case "activeCustomers":
      return available(
        await scalar(
          input.database,
          `SELECT COUNT(DISTINCT orders.customer_id) AS value, MAX(reaction.applied_at) AS watermark, ${scope.missing} AS missingAttribution ${scopedOrderJoin}`,
          orderBinds,
        ),
        input.window,
        input.computedAt,
      );
    case "newCustomers":
    case "repeatCustomers":
    case "repeatOrders":
      return available(
        await scalar(
          input.database,
          `SELECT ${input.queryKey === "repeatOrders" ? "COUNT(*)" : "COUNT(DISTINCT orders.customer_id)"} AS value,
            MAX(reaction.applied_at) AS watermark, ${scope.missing} AS missingAttribution ${scopedOrderJoin}
            AND ${input.queryKey === "newCustomers" ? "NOT " : ""}${priorPurchase}`,
          orderBinds,
        ),
        input.window,
        input.computedAt,
      );
    case "refundAmount":
    case "receivedAmount":
      return confirmedMoney(input);
    case "promotionRedemptions": {
      return committedPromotions(input);
    }
  }
  return unavailable("Metric query is not available.", input.computedAt);
}

// Completion is terminal; pending refund/cancellation attempts are not completed
// cancellations. The audit fallback covers unpaid Orders with no cancellation row.
const canceledAt = `COALESCE(
  (SELECT cancellation.updated_at FROM order_cancellation cancellation
   WHERE cancellation.order_id=orders.id AND cancellation.status='COMPLETED'
     AND cancellation.actor_type!='STAFF_EXCEPTION'),
  (SELECT MIN(audit.occurred_at) FROM audit_event audit WHERE audit.aggregate_id=orders.id
   AND audit.aggregate_type='order' AND audit.action='ORDER.CANCELED'
   AND json_extract(audit.details_json,'$.outcome')='CANCELED'))`;

async function orderEvents(input: MetricQueryInput): Promise<MetricQueryResult> {
  const scope = reportScope(input.scope);
  const delivered = input.queryKey === "deliveredOrders";
  const row = await input.database
    .prepare(`WITH events AS (
    SELECT orders.created_at,snapshot.location_id, ${delivered ? "(SELECT MIN(job.delivered_at) FROM delivery_job job WHERE job.order_id=orders.id)" : canceledAt} AS event_at
    FROM grocery_order orders LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id
    WHERE orders.status=?${scope.clause}
  ) SELECT COUNT(*) AS value, MAX(event_at) AS watermark,
    ${scope.missing} AS missingAttribution, COUNT(CASE WHEN event_at IS NULL THEN 1 END) AS missing
    FROM events WHERE (event_at>=? AND event_at<?) OR (event_at IS NULL AND created_at<?)`)
    .bind(
      delivered ? "DELIVERED" : "CANCELED",
      ...scope.binds,
      Date.parse(input.window.startAt),
      Date.parse(input.window.endAt),
      Date.parse(input.window.endAt),
    )
    .first<ScalarRow & { missing: number }>();
  if (!row || row.missing)
    return unavailable(
      "Retained Orders lack a completion date needed for this report.",
      input.computedAt,
    );
  return available(row, input.window, input.computedAt);
}

async function productQuantity(input: MetricQueryInput): Promise<MetricQueryResult> {
  const skuId = selectedDimension(input.dimensions, "skuId");
  if (!skuId)
    return unavailable(
      "Select a Product selling option to view quantities without combining different units.",
      input.computedAt,
    );
  const scope = reportScope(input.scope);
  const canceled = input.queryKey === "canceledProductQuantity";
  const row = await input.database
    .prepare(`WITH paid_lines AS (
    SELECT line.order_id,line.sku_id,line.quantity,reaction.applied_at AS paid_at
    FROM order_item line JOIN order_payment_reaction reaction ON reaction.order_id=line.order_id
    UNION ALL
    SELECT amendment.order_id,line.sku_id,line.quantity,amendment.committed_at AS paid_at
    FROM paid_order_amendment_line line JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id
    WHERE amendment.status='COMMITTED'
  ), events AS (
    SELECT lines.quantity,orders.created_at,snapshot.location_id,${canceled ? canceledAt : "lines.paid_at"} AS event_at
    FROM paid_lines lines JOIN grocery_order orders ON orders.id=lines.order_id
    LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id
    WHERE lines.sku_id=?${canceled ? " AND orders.status='CANCELED'" : ""}${scope.clause}
  ) SELECT COALESCE(SUM(quantity),0) AS value, MAX(event_at) AS watermark,
    ${scope.missing} AS missingAttribution, COUNT(CASE WHEN event_at IS NULL THEN 1 END) AS missing
    FROM events WHERE (event_at>=? AND event_at<?) OR (event_at IS NULL AND created_at<?)`)
    .bind(
      skuId,
      ...scope.binds,
      Date.parse(input.window.startAt),
      Date.parse(input.window.endAt),
      Date.parse(input.window.endAt),
    )
    .first<ScalarRow & { missing: number }>();
  if (!row || row.missing)
    return unavailable(
      "Retained Product purchases lack a commitment or cancellation date.",
      input.computedAt,
    );
  return available(row, input.window, input.computedAt);
}

async function committedPromotions(input: MetricQueryInput): Promise<MetricQueryResult> {
  const money = input.queryKey === "discountSpend";
  const currency = selectedDimension(input.dimensions, "currency");
  if (money && !currency)
    return unavailable("Select a currency to view discounts.", input.computedAt);
  const promotion = selectedDimension(input.dimensions, "promotionId");
  const benefit = selectedDimension(input.dimensions, "promotionBenefitType");
  const scope = reportScope(input.scope);
  const row = await scalar(
    input.database,
    `SELECT
      ${money ? "COALESCE(SUM(application.amount_minor),0)" : "COUNT(DISTINCT application.redemption_id)"} AS value,
      MAX(application.created_at) AS watermark, ${scope.missing} AS missingAttribution
    FROM order_promotion_application application
    JOIN grocery_order orders ON orders.id=application.order_id
    JOIN order_payment_reaction commitment ON commitment.order_id=orders.id
    LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id
    WHERE application.created_at>=? AND application.created_at<?
      AND (application.amendment_id IS NULL OR EXISTS (SELECT 1 FROM paid_order_amendment amendment
        WHERE amendment.id=application.amendment_id AND amendment.order_id=orders.id AND amendment.status='COMMITTED'))
      ${money ? " AND orders.currency=?" : ""}${promotion ? " AND application.promotion_id=?" : ""}
      ${benefit ? " AND application.benefit_type=?" : ""}${scope.clause}`,
    [
      Date.parse(input.window.startAt),
      Date.parse(input.window.endAt),
      ...(money ? [currency] : []),
      ...(promotion ? [promotion] : []),
      ...(benefit ? [benefit] : []),
      ...scope.binds,
    ],
  );
  return available(row, input.window, input.computedAt);
}

async function deliveryMoney(input: MetricQueryInput): Promise<MetricQueryResult> {
  const currency = selectedDimension(input.dimensions, "currency");
  if (!currency)
    return unavailable(
      "Select a currency to compare delivery charges and costs.",
      input.computedAt,
    );
  const scope = reportScope(input.scope);
  const costs = input.queryKey === "deliveryCosts";
  const row = await input.database
    .prepare(`WITH cohort AS (
    SELECT orders.id,snapshot.location_id,orders.delivery_subtotal_minor-orders.delivery_discount_minor +
      COALESCE((SELECT SUM(amendment.delivery_subtotal_minor-amendment.delivery_discount_minor)
        FROM paid_order_amendment amendment WHERE amendment.order_id=orders.id AND amendment.status='COMMITTED'),0) AS charge,
      reaction.applied_at
    FROM grocery_order orders JOIN order_payment_reaction reaction ON reaction.order_id=orders.id
    LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id
    WHERE reaction.applied_at>=? AND reaction.applied_at<? AND orders.currency=?${scope.clause}
  ), amounts AS (
    SELECT cohort.*, (SELECT SUM(dispatch.final_payable_minor) FROM delivery_job job
      JOIN delivery_provider_dispatch dispatch ON dispatch.delivery_job_id=job.id
      WHERE job.order_id=cohort.id AND dispatch.delivery_currency=?) AS cost,
      EXISTS (SELECT 1 FROM delivery_job job JOIN delivery_provider_dispatch dispatch ON dispatch.delivery_job_id=job.id
        WHERE job.order_id=cohort.id AND (dispatch.final_payable_minor IS NULL OR dispatch.delivery_currency IS NULL OR dispatch.delivery_currency!=?)) AS unknown_cost
    FROM cohort
  ) SELECT COALESCE(SUM(${costs ? "cost" : "charge"}),0) AS value,MAX(applied_at) AS watermark, ${scope.missing} AS missingAttribution,
    COUNT(CASE WHEN cost IS NULL OR unknown_cost THEN 1 END) AS missing FROM amounts`)
    .bind(
      Date.parse(input.window.startAt),
      Date.parse(input.window.endAt),
      currency,
      ...scope.binds,
      currency,
      currency,
    )
    .first<ScalarRow & { missing: number }>();
  if (!row || (costs && row.missing))
    return unavailable(
      "Some Orders in this period have no recorded delivery cost in the selected currency.",
      input.computedAt,
    );
  return available(row, input.window, input.computedAt);
}

/** Payments confirmation is independent of Order commitment or later refunds. */
async function confirmedMoney(input: MetricQueryInput): Promise<MetricQueryResult> {
  const currency = selectedDimension(input.dimensions, "currency");
  if (!currency)
    return unavailable("Select a currency to view money received or refunded.", input.computedAt);
  const scope = scopePredicate(input.scope, "facts");
  const refund = input.queryKey === "refundAmount";
  const at = refund ? "refund.succeeded_at" : "reaction.created_at";
  const amount = refund ? "refund.amount_minor" : "payment.amount_minor";
  const created = refund ? "refund.created_at" : "payment.created_at";
  const lastRecorded = refund ? "refund.updated_at" : "payment.updated_at";
  // For a retained success with no precise date, creation and the last recorded
  // update bound its possible confirmation interval. Do not assign either date
  // as success, or block a later period that cannot contain that old success.
  const row = await input.database
    .prepare(`WITH facts AS (
    SELECT ${at} AS confirmed_at, ${amount} AS amount_minor, ${created} AS created_at, ${lastRecorded} AS last_recorded_at,
      COALESCE(snapshot.location_id,
        CASE WHEN json_valid(quote.cycle_snapshot_json)
          THEN json_extract(quote.cycle_snapshot_json,'$.locationId') END) AS location_id
    FROM payment_intent payment
    LEFT JOIN (SELECT payment_intent_id,MIN(created_at) AS created_at FROM payment_reaction
      GROUP BY payment_intent_id) reaction ON reaction.payment_intent_id=payment.id
    LEFT JOIN checkout_quote quote ON payment.subject_type='checkout_quote' AND quote.id=payment.subject_id
    LEFT JOIN order_payment_reaction commitment ON commitment.payment_intent_id=payment.id
    LEFT JOIN paid_order_amendment amendment ON payment.subject_type='paid_order_amendment' AND amendment.id=payment.subject_id
    LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=COALESCE(commitment.order_id,amendment.order_id)
    ${refund ? "JOIN payment_refund refund ON refund.payment_intent_id=payment.id AND refund.status='SUCCEEDED'" : ""}
    WHERE (?=1 OR payment.purpose IN ('GROCERY_CHECKOUT','ORDER_AMENDMENT')) AND payment.currency=?
      ${refund ? "AND refund.currency=payment.currency" : "AND (reaction.created_at IS NOT NULL OR payment.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))"}
  ) SELECT COALESCE(SUM(CASE WHEN confirmed_at>=? AND confirmed_at<? THEN amount_minor ELSE 0 END),0) AS value,
    MAX(CASE WHEN confirmed_at>=? AND confirmed_at<? THEN confirmed_at END) AS watermark,
    COALESCE(SUM(CASE WHEN confirmed_at IS NULL OR (?=1 AND location_id IS NULL) THEN 1 ELSE 0 END),0) AS missing
  FROM facts WHERE created_at<? AND ((confirmed_at IS NULL AND last_recorded_at>=?) OR (confirmed_at>=? AND confirmed_at<?))${scope.clause ? ` AND (location_id IS NULL OR (1=1${scope.clause}))` : ""}`)
    .bind(
      input.scope.kind === "global" ? 1 : 0,
      currency,
      Date.parse(input.window.startAt),
      Date.parse(input.window.endAt),
      Date.parse(input.window.startAt),
      Date.parse(input.window.endAt),
      input.scope.kind === "global" ? 0 : 1,
      Date.parse(input.window.endAt),
      Date.parse(input.window.startAt),
      Date.parse(input.window.startAt),
      Date.parse(input.window.endAt),
      ...scope.binds,
    )
    .first<ScalarRow & { missing: number }>();
  if (!row || row.missing > 0)
    return unavailable(
      "Retained payment records lack a confirmed date or location needed for this report.",
      input.computedAt,
    );
  return available(row, input.window, input.computedAt);
}
