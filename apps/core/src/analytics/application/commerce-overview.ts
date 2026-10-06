import { Temporal } from "temporal-polyfill";
import type {
  AdminCommerceMetric,
  AdminCommerceOverview,
  AdminSelectedScope,
  Capability,
} from "@freshmarkets/contracts";

type Input = {
  scope: AdminSelectedScope;
  timezone: string;
  period: "7d" | "30d" | "90d";
  capabilities: ReadonlyArray<Capability>;
  now?: number;
};
const DAY_COUNTS = { "7d": 7, "30d": 30, "90d": 90 } as const;
const MISSING = "Retained records lack the confirmed date or location required for this report.";
const UNSAFE = "This total exceeds the supported exact numeric range.";

function metric(
  value: number | null,
  previousValue: number | null = null,
  reason: string | null = null,
): AdminCommerceMetric {
  if (
    (value !== null && !Number.isFinite(value)) ||
    (previousValue !== null && !Number.isFinite(previousValue))
  )
    return { value: null, previousValue: null, unavailableReason: UNSAFE };
  return { value, previousValue, unavailableReason: reason };
}
function exact(value: number) {
  return Number.isSafeInteger(value) ? value : null;
}

function requireAggregate<T>(row: T | null | undefined): T {
  if (row === null || row === undefined)
    throw new Error("Required commerce aggregate was not returned");
  return row;
}

/** Version 1 Home projection. Called only after Overview proves current Staff scope and analytics.read. */
export async function readCommerceOverview(
  db: D1Database,
  input: Input,
): Promise<AdminCommerceOverview> {
  const now = input.now ?? Date.now();
  const current = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(input.timezone);
  const start = current.subtract({ days: DAY_COUNTS[input.period] });
  const previous = start.subtract({ days: DAY_COUNTS[input.period] });
  const month = current.with({ day: 1 }).startOfDay();
  const year = current.with({ month: 1, day: 1 }).startOfDay();
  const from = start.epochMilliseconds;
  const before = previous.epochMilliseconds;
  const scopeBind =
    input.scope.kind === "GLOBAL"
      ? []
      : [input.scope.kind === "LOCATION" ? input.scope.locationId : input.scope.marketId];
  const locationFilter =
    input.scope.kind === "GLOBAL"
      ? "1=1"
      : input.scope.kind === "LOCATION"
        ? "location_id=?"
        : "location_id IN (SELECT id FROM fulfillment_location WHERE market_id=?)";
  const scoped =
    input.scope.kind === "GLOBAL" ? "1=1" : `(location_id IS NULL OR ${locationFilter})`;
  const has = (read: Capability, manage: Capability) =>
    input.capabilities.includes(read) || input.capabilities.includes(manage);
  const canUsers = input.scope.kind === "GLOBAL" && has("customers.read", "customers.manage");
  const canOrders = input.scope.kind === "GLOBAL" && has("orders.read", "orders.manage");
  const canPayments = input.scope.kind === "GLOBAL" && has("payments.read", "payments.manage");
  const paidCte = `WITH purchases AS (
    SELECT orders.id,orders.customer_id,reaction.applied_at AS at,snapshot.location_id,
      EXISTS(SELECT 1 FROM grocery_order prior JOIN order_payment_reaction pr ON pr.order_id=prior.id
        WHERE prior.customer_id=orders.customer_id AND (pr.applied_at<reaction.applied_at OR
          (pr.applied_at=reaction.applied_at AND prior.id<orders.id))) AS is_returning
    FROM grocery_order orders JOIN order_payment_reaction reaction ON reaction.order_id=orders.id
    LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id
  )`;
  const purchases = requireAggregate(
    await db
      .prepare(`${paidCte} SELECT
    COUNT(CASE WHEN at>=? THEN 1 END) AS orders,
    COUNT(CASE WHEN at<? THEN 1 END) AS previousOrders,
    COUNT(DISTINCT CASE WHEN at>=? THEN customer_id END) AS customers,
    COUNT(DISTINCT CASE WHEN at<? THEN customer_id END) AS previousCustomers,
    COUNT(DISTINCT CASE WHEN at>=? AND is_returning THEN customer_id END) AS returningCustomers,
    COUNT(DISTINCT CASE WHEN at<? AND is_returning THEN customer_id END) AS previousReturning,
    COUNT(CASE WHEN location_id IS NULL THEN 1 END) AS missing
    FROM purchases WHERE at>=? AND at<? AND ${scoped}`)
      .bind(from, from, from, from, from, from, before, now, ...scopeBind)
      .first<{
        orders: number;
        previousOrders: number;
        customers: number;
        previousCustomers: number;
        returningCustomers: number;
        previousReturning: number;
        missing: number;
      }>(),
  );
  const bins: { date: string; start: number; end: number }[] = [];
  for (
    let day = start.toPlainDate();
    Temporal.PlainDate.compare(day, current.toPlainDate()) <= 0;
    day = day.add({ days: 1 })
  ) {
    const boundary = day.toZonedDateTime(input.timezone);
    bins.push({
      date: day.toString(),
      start: Math.max(from, boundary.epochMilliseconds),
      end: Math.min(now, boundary.add({ days: 1 }).epochMilliseconds),
    });
  }
  const binCte = `bins AS (SELECT json_extract(value,'$.date') date,json_extract(value,'$.start') lower,json_extract(value,'$.end') upper FROM json_each(?))`;
  const purchaseRows = (
    await db
      .prepare(`${paidCte}, ${binCte} SELECT bins.date,
    COUNT(purchases.id) orders,COUNT(DISTINCT customer_id) customers,
    COUNT(DISTINCT CASE WHEN is_returning THEN customer_id END) returningCustomers
    FROM bins LEFT JOIN purchases ON at>=bins.lower AND at<bins.upper AND ${locationFilter}
    GROUP BY bins.date ORDER BY bins.date`)
      .bind(JSON.stringify(bins), ...scopeBind)
      .all<{ date: string; orders: number; customers: number; returningCustomers: number }>()
  ).results;

  // Match approved Payments report evidence: immutable reaction dates survive later refund/status changes.
  const moneyCte = `WITH captured AS (
    SELECT payment.id,payment.amount_minor,payment.currency,payment.status,payment.created_at,payment.updated_at,
      reaction.at,COALESCE(snapshot.location_id,CASE WHEN json_valid(quote.cycle_snapshot_json)
        THEN json_extract(quote.cycle_snapshot_json,'$.locationId') END) AS location_id,
      COALESCE(commitment.order_id,amendment.order_id) AS order_id
    FROM payment_intent payment
    LEFT JOIN (SELECT payment_intent_id,MIN(created_at) AS at FROM payment_reaction GROUP BY payment_intent_id) reaction ON reaction.payment_intent_id=payment.id
    LEFT JOIN checkout_quote quote ON payment.subject_type='checkout_quote' AND quote.id=payment.subject_id
    LEFT JOIN order_payment_reaction commitment ON commitment.payment_intent_id=payment.id
    LEFT JOIN paid_order_amendment amendment ON payment.subject_type='paid_order_amendment' AND amendment.id=payment.subject_id
    LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=COALESCE(commitment.order_id,amendment.order_id)
    WHERE payment.purpose IN ('GROCERY_CHECKOUT','ORDER_AMENDMENT') AND payment.currency='PHP'
      AND (reaction.at IS NOT NULL OR payment.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))
  ), facts AS (
    SELECT 'received' kind,amount_minor,at,created_at,updated_at,location_id FROM captured
    UNION ALL SELECT 'refunded',refund.amount_minor,refund.succeeded_at,refund.created_at,refund.updated_at,captured.location_id
      FROM payment_refund refund JOIN captured ON captured.id=refund.payment_intent_id
      WHERE refund.status='SUCCEEDED' AND refund.currency='PHP'
  )`;
  const ranges = [
    ["current", from],
    ["previous", before],
    ["month", month.epochMilliseconds],
    ["year", year.epochMilliseconds],
  ] as const;
  const money = await Promise.all(
    ranges.map(async ([code, lower]) => {
      const upper = code === "previous" ? from : now;
      const row = requireAggregate(
        await db
          .prepare(`${moneyCte} SELECT
      COALESCE(SUM(CASE WHEN kind='received' AND at>=? AND at<? THEN amount_minor ELSE 0 END),0) received,
      COALESCE(SUM(CASE WHEN kind='refunded' AND at>=? AND at<? THEN amount_minor ELSE 0 END),0) refunded,
      COUNT(CASE WHEN kind='received' AND (at IS NULL OR (?=1 AND location_id IS NULL)) THEN 1 END) receivedMissing,
      COUNT(CASE WHEN kind='refunded' AND (at IS NULL OR (?=1 AND location_id IS NULL)) THEN 1 END) refundedMissing
      FROM facts WHERE created_at<? AND ((at IS NULL AND updated_at>=?) OR (at>=? AND at<?)) AND ${scoped}`)
          .bind(
            lower,
            upper,
            lower,
            upper,
            input.scope.kind === "GLOBAL" ? 0 : 1,
            input.scope.kind === "GLOBAL" ? 0 : 1,
            upper,
            lower,
            lower,
            upper,
            ...scopeBind,
          )
          .first<{
            received: number;
            refunded: number;
            receivedMissing: number;
            refundedMissing: number;
          }>(),
      );
      return { code, ...row };
    }),
  );
  const m = (code: string) => requireAggregate(money.find((row) => row.code === code));
  const moneyMetric = (code: string, kind: "received" | "refunded", compare = false) =>
    metric(
      m(code)[kind === "received" ? "receivedMissing" : "refundedMissing"]
        ? null
        : exact(m(code)[kind]),
      compare && !m("previous")[kind === "received" ? "receivedMissing" : "refundedMissing"]
        ? exact(m("previous")[kind])
        : null,
      m(code)[kind === "received" ? "receivedMissing" : "refundedMissing"]
        ? MISSING
        : exact(m(code)[kind]) === null
          ? UNSAFE
          : null,
    );
  const moneyRows = (
    await db
      .prepare(`${moneyCte}, ${binCte} SELECT bins.date,
    COALESCE(SUM(CASE WHEN kind='received' THEN amount_minor ELSE 0 END),0) receivedMinor,
    COALESCE(SUM(CASE WHEN kind='refunded' THEN amount_minor ELSE 0 END),0) refundedMinor
    FROM bins LEFT JOIN facts ON at>=bins.lower AND at<bins.upper AND ${locationFilter}
    GROUP BY bins.date ORDER BY bins.date`)
      .bind(JSON.stringify(bins), ...scopeBind)
      .all<{ date: string; receivedMinor: number; refundedMinor: number }>()
  ).results;

  const users = canUsers
    ? await db
        .prepare(`SELECT COUNT(*) total,
    COUNT(CASE WHEN created_at<? THEN 1 END) previousTotal,
    COUNT(CASE WHEN created_at>=? THEN 1 END) added,
    COUNT(CASE WHEN created_at>=? AND created_at<? THEN 1 END) previousAdded,
    COUNT(CASE WHEN created_at<? THEN 1 END) baseline FROM customer WHERE created_at<?`)
        .bind(from, from, before, from, before, now)
        .first<{
          total: number;
          previousTotal: number;
          added: number;
          previousAdded: number;
          baseline: number;
        }>()
    : null;
  const userRows = canUsers
    ? (
        await db
          .prepare(`WITH ${binCte} SELECT bins.date,COUNT(customer.id) count
    FROM bins LEFT JOIN customer ON created_at>=bins.lower AND created_at<bins.upper
    GROUP BY bins.date ORDER BY bins.date`)
          .bind(JSON.stringify(bins))
          .all<{ date: string; count: number }>()
      ).results
    : [];
  const growth = (added: number, baseline: number) => (baseline ? (added / baseline) * 100 : null);
  const products = (
    await db
      .prepare(`WITH lines AS (
    SELECT line.sku_id,line.product_name_snapshot,line.variant_name_snapshot,line.unit_snapshot,line.quantity,line.line_total_minor,reaction.applied_at at,snapshot.location_id,orders.currency
    FROM order_item line JOIN grocery_order orders ON orders.id=line.order_id JOIN order_payment_reaction reaction ON reaction.order_id=orders.id
    LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id
    UNION ALL SELECT line.sku_id,line.product_name_snapshot,line.variant_name_snapshot,line.unit_snapshot,line.quantity,line.line_total_minor,amendment.committed_at,snapshot.location_id,orders.currency
    FROM paid_order_amendment_line line JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id
    JOIN grocery_order orders ON orders.id=amendment.order_id LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id WHERE amendment.status='COMMITTED'
  ) SELECT sku_id skuId,product_name_snapshot productName,variant_name_snapshot variantName,unit_snapshot unit,
    SUM(quantity) quantity,SUM(line_total_minor) grossSalesMinor FROM lines WHERE at>=? AND at<? AND currency='PHP' AND ${scoped}
    GROUP BY sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot ORDER BY grossSalesMinor DESC,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot LIMIT 8`)
      .bind(from, now, ...scopeBind)
      .all<AdminCommerceOverview["products"][number]>()
  ).results;
  const productMissing =
    input.scope.kind !== "GLOBAL" &&
    requireAggregate(
      await db
        .prepare(`SELECT COUNT(*) count FROM (
    SELECT reaction.applied_at at,snapshot.location_id FROM order_item line JOIN order_payment_reaction reaction ON reaction.order_id=line.order_id LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=line.order_id
    UNION ALL SELECT amendment.committed_at,snapshot.location_id FROM paid_order_amendment_line line JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=amendment.order_id WHERE amendment.status='COMMITTED'
  ) WHERE at>=? AND at<? AND location_id IS NULL`)
        .bind(from, now)
        .first<{ count: number }>(),
    ).count > 0;
  const productsUnavailableReason = productMissing
    ? MISSING
    : products.some((row) => exact(row.quantity) === null || exact(row.grossSalesMinor) === null)
      ? UNSAFE
      : null;
  const recentOrders = canOrders
    ? (
        await db
          .prepare(`SELECT o.id orderId,o.order_number orderNumber,u.name customerName,o.status,o.total_minor totalMinor,o.currency,o.created_at createdAt
    FROM grocery_order o LEFT JOIN customer c ON c.id=o.customer_id LEFT JOIN user u ON u.id=c.auth_user_id
    WHERE o.created_at>=? AND o.created_at<? ORDER BY o.created_at DESC,o.id DESC LIMIT 6`)
          .bind(from, now)
          .all<
            Omit<AdminCommerceOverview["recentOrders"][number], "createdAt"> & { createdAt: number }
          >()
      ).results.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }))
    : [];
  const recentTransactions = canPayments
    ? (
        await db
          .prepare(`${moneyCte} SELECT captured.id paymentIntentId,captured.order_id orderId,o.order_number orderNumber,captured.status,captured.amount_minor amountMinor,captured.currency,captured.at confirmedAt
    FROM captured LEFT JOIN grocery_order o ON o.id=captured.order_id WHERE captured.at>=? AND captured.at<? ORDER BY captured.at DESC,captured.id DESC LIMIT 6`)
          .bind(from, now)
          .all<
            Omit<AdminCommerceOverview["recentTransactions"][number], "confirmedAt"> & {
              confirmedAt: number;
            }
          >()
      ).results.map((row) => ({ ...row, confirmedAt: new Date(row.confirmedAt).toISOString() }))
    : [];
  const purchaseMissing = input.scope.kind !== "GLOBAL" && purchases.missing > 0;
  const userReason = "Global customers.read access is required for registered Customer accounts.";
  return {
    definitionVersion: 1,
    period: input.period,
    startAt: new Date(from).toISOString(),
    endAt: new Date(now).toISOString(),
    timezone: input.timezone,
    currency: "PHP",
    computedAt: new Date(now).toISOString(),
    revenue: moneyMetric("current", "received", true),
    monthlyRevenue: moneyMetric("month", "received"),
    yearlyRevenue: moneyMetric("year", "received"),
    refunds: moneyMetric("current", "refunded", true),
    orders: metric(
      purchaseMissing ? null : purchases.orders,
      purchaseMissing ? null : purchases.previousOrders,
      purchaseMissing ? MISSING : null,
    ),
    purchasingCustomers: metric(
      purchaseMissing ? null : purchases.customers,
      purchaseMissing ? null : purchases.previousCustomers,
      purchaseMissing ? MISSING : null,
    ),
    returningRate: metric(
      purchaseMissing || !purchases.customers
        ? null
        : (purchases.returningCustomers / purchases.customers) * 100,
      purchaseMissing || !purchases.previousCustomers
        ? null
        : (purchases.previousReturning / purchases.previousCustomers) * 100,
      purchaseMissing
        ? MISSING
        : !purchases.customers
          ? "No purchasing customers in this period."
          : null,
    ),
    users: users ? metric(users.total, users.previousTotal) : metric(null, null, userReason),
    userGrowth: users
      ? metric(
          growth(users.added, users.previousTotal),
          growth(users.previousAdded, users.baseline),
          !users.previousTotal ? "No registered users at the start of this period." : null,
        )
      : metric(null, null, userReason),
    series: bins.map((bin) => {
      const purchase = requireAggregate(purchaseRows.find((row) => row.date === bin.date));
      const payment = requireAggregate(moneyRows.find((row) => row.date === bin.date));
      return {
        date: bin.date,
        receivedMinor: m("current").receivedMissing ? null : exact(payment.receivedMinor),
        refundedMinor: m("current").refundedMissing ? null : exact(payment.refundedMinor),
        orders: purchaseMissing ? null : purchase.orders,
        customers: purchaseMissing ? null : purchase.customers,
        returningCustomers: purchaseMissing ? null : purchase.returningCustomers,
        newUsers: canUsers
          ? requireAggregate(userRows.find((row) => row.date === bin.date)).count
          : null,
      };
    }),
    products: productsUnavailableReason ? [] : products,
    productsUnavailableReason,
    recentOrders,
    recentTransactions,
    deniedSections: [
      ...(!canUsers ? ["users"] : []),
      ...(!canOrders ? ["recentOrders"] : []),
      ...(!canPayments ? ["recentTransactions"] : []),
      ...(purchaseMissing ? ["purchaseSeries"] : []),
    ],
  };
}
