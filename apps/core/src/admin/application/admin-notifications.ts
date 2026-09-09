import type { AdminDashboardNotification, Capability } from "@freshmarkets/contracts";

/** Read consequences of recorded commerce facts within the overview's already-authorized scope. */
export async function readAdminNotifications(
  db: D1Database,
  access: {
    locationIds: readonly string[];
    globalView: boolean;
    globalStaff: boolean;
    capabilities: readonly Capability[];
  },
): Promise<AdminDashboardNotification[]> {
  const commercial = access.globalStaff && access.capabilities.includes("orders.read");
  const fulfillment = access.capabilities.includes("fulfillment.read");
  const delivery = access.capabilities.includes("delivery.read");
  const finance = access.globalStaff && access.capabilities.includes("payments.read");
  const rows = await db
    .prepare(`WITH orders AS (
    SELECT o.id,o.order_number,o.committed_at,f.location_id,location.market_id
    FROM grocery_order o LEFT JOIN fulfillment_record f ON f.order_id=o.id
    LEFT JOIN fulfillment_location location ON location.id=f.location_id
    WHERE ?=1 OR f.location_id IN (SELECT value FROM json_each(?))
  ), payment_orders AS (
    SELECT payment_intent_id,order_id FROM order_payment_reaction WHERE order_id IS NOT NULL
    UNION SELECT payment_intent_id,order_id FROM paid_order_amendment WHERE payment_intent_id IS NOT NULL
  ), notices AS (
    SELECT 'ORDER_CONFIRMED' type,'order:' || o.id id,o.id orderId,o.order_number orderNumber,
      o.location_id locationId,o.market_id marketId,o.committed_at occurredAt,o.id targetId
    FROM orders o WHERE ?=1 AND o.committed_at IS NOT NULL
    UNION ALL
    SELECT n.event_type,'delivery:' || n.id,o.id,o.order_number,o.location_id,o.market_id,n.scheduled_at,o.id
    FROM notification_outbox n JOIN orders o ON o.id=n.aggregate_id
    WHERE ?=1 AND n.aggregate_type='DELIVERY' AND n.event_type IN ('OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED')
    UNION ALL
    SELECT 'PROBLEM_REPORTED','problem:' || issue.id,o.id,o.order_number,o.location_id,o.market_id,issue.created_at,issue.id
    FROM order_issue issue JOIN orders o ON o.id=issue.order_id WHERE ?=1 AND issue.status!='RESOLVED'
    UNION ALL
    SELECT 'REFUND_ATTENTION','refund:' || refund.id,o.id,o.order_number,o.location_id,o.market_id,refund.updated_at,refund.payment_intent_id
    FROM payment_refund refund JOIN payment_orders payment ON payment.payment_intent_id=refund.payment_intent_id
    JOIN orders o ON o.id=payment.order_id WHERE ?=1 AND refund.status IN ('FAILED','ESCALATED')
  ) SELECT * FROM notices ORDER BY occurredAt DESC,id DESC LIMIT 24`)
    .bind(
      Number(access.globalView),
      JSON.stringify(access.locationIds),
      Number(commercial || fulfillment),
      Number(commercial || delivery),
      Number(commercial),
      Number(finance),
    )
    .all<{
      type: string;
      id: string;
      orderId: string;
      orderNumber: string | null;
      locationId: string | null;
      marketId: string | null;
      occurredAt: number;
      targetId: string;
    }>();
  const labels: Record<string, string> = {
    ORDER_CONFIRMED: "New paid order",
    OUT_FOR_DELIVERY: "Order picked up",
    DELIVERED: "Order delivered",
    DELIVERY_FAILED: "Delivery attempt failed",
    PROBLEM_REPORTED: "Customer reported a problem",
    REFUND_ATTENTION: "Refund needs attention",
  };
  return rows.results.flatMap((row) => {
    const direct =
      row.type === "PROBLEM_REPORTED"
        ? `/admin/issues/${encodeURIComponent(row.targetId)}`
        : row.type === "REFUND_ATTENTION"
          ? `/admin/payments/${encodeURIComponent(row.targetId)}`
          : commercial
            ? `/admin/orders/${encodeURIComponent(row.orderId)}`
            : null;
    if (
      !direct &&
      (!row.locationId || !row.marketId || !access.locationIds.includes(row.locationId))
    )
      return [];
    return [
      {
        id: row.id,
        label: labels[row.type] ?? "Order update",
        orderId: row.orderId,
        orderNumber: row.orderNumber ?? row.orderId,
        occurredAt: new Date(row.occurredAt).toISOString(),
        href:
          direct ??
          `/admin/${row.type === "ORDER_CONFIRMED" ? "fulfillment" : "delivery"}?orderId=${encodeURIComponent(row.orderId)}`,
        scope:
          !direct && row.locationId && row.marketId
            ? { kind: "LOCATION" as const, locationId: row.locationId, marketId: row.marketId }
            : null,
      },
    ];
  });
}
