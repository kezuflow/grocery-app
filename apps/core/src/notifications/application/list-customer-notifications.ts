import {
  customerNotificationTypes,
  type CustomerNotificationType,
  type CustomerNotificationsView,
  type RpcResult,
} from "@freshmarkets/contracts";

const labels: Record<CustomerNotificationType, string> = {
  ORDER_CONFIRMED: "Order confirmed",
  PAYMENT_ACTION_REQUIRED: "Payment action required",
  PAYMENT_FAILED: "Payment failed",
  SCHEDULED_CUTOFF_REMINDER: "Scheduled cutoff reminder",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  DELIVERY_FAILED: "Delivery failed",
  ORDER_CANCELLATION_REQUESTED: "Cancellation received",
  ORDER_REFUND_PROGRESSING: "Refund processing",
  ORDER_REFUND_COMPLETED: "Refund completed",
  ORDER_CANCELLATION_COMPLETED: "Cancellation completed",
  ORDER_REFUND_EXCEPTION: "Refund needs support",
};

/** Read recorded events, independently of email delivery. Identity comes only from Core access. */
export async function listCustomerNotifications(
  db: D1Database,
  input: { customerId: string; requestId: string },
  now = Date.now(),
): Promise<RpcResult<CustomerNotificationsView>> {
  const rows = await db
    .prepare(`WITH owned_orders AS (
    SELECT id,order_number,committed_at FROM grocery_order WHERE customer_id=?
  ), notices AS (
    SELECT 'ORDER_CONFIRMED' type, 'order:'||o.id sortId, o.id orderId,
      o.order_number reference,o.committed_at occurredAt
    FROM owned_orders o WHERE o.committed_at IS NOT NULL AND o.committed_at<=?
    UNION ALL
    SELECT n.event_type,n.id,o.id,o.order_number,n.scheduled_at
    FROM notification_outbox n
    LEFT JOIN order_cancellation c ON n.aggregate_type='ORDER_CANCELLATION' AND c.id=n.aggregate_id
    JOIN owned_orders o ON o.id=CASE WHEN n.aggregate_type='ORDER_CANCELLATION' THEN c.order_id ELSE n.aggregate_id END
    WHERE n.customer_id=? AND n.scheduled_at<=?
      AND (n.event_type!='ORDER_REFUND_EXCEPTION' OR c.status='EXCEPTION') AND (
      (n.aggregate_type='ORDER' AND n.event_type='SCHEDULED_CUTOFF_REMINDER') OR
      (n.aggregate_type='DELIVERY' AND n.event_type IN ('OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED')) OR
      (n.aggregate_type='ORDER_CANCELLATION' AND n.event_type IN
        ('ORDER_CANCELLATION_REQUESTED','ORDER_REFUND_PROGRESSING','ORDER_CANCELLATION_COMPLETED','ORDER_REFUND_EXCEPTION'))
    )
    UNION ALL
    SELECT n.event_type,n.id,o.id,COALESCE(o.order_number,'Checkout payment'),n.scheduled_at
    FROM notification_outbox n JOIN payment_intent p ON p.id=n.aggregate_id AND p.customer_id=?
    LEFT JOIN paid_order_amendment a ON a.payment_intent_id=p.id
    LEFT JOIN owned_orders o ON o.id=a.order_id
    WHERE n.customer_id=? AND n.aggregate_type='PAYMENT' AND n.scheduled_at<=?
      AND p.purpose IN ('GROCERY_CHECKOUT','ORDER_AMENDMENT')
      AND (p.purpose='GROCERY_CHECKOUT' OR o.id IS NOT NULL)
      AND ((n.event_type='PAYMENT_ACTION_REQUIRED' AND p.status='REQUIRES_ACTION')
        OR (n.event_type='PAYMENT_FAILED' AND p.status='FAILED'))
    UNION ALL
    SELECT 'ORDER_REFUND_COMPLETED','refund:'||c.id,o.id,o.order_number,c.updated_at
    FROM order_cancellation c JOIN owned_orders o ON o.id=c.order_id
    WHERE c.status='COMPLETED' AND c.required_refund_minor>0 AND c.updated_at<=?
      AND EXISTS (SELECT 1 FROM order_cancellation_refund_member m WHERE m.cancellation_id=c.id)
      AND NOT EXISTS (
        SELECT 1 FROM order_cancellation_refund_member m LEFT JOIN payment_refund r ON r.id=m.refund_id
        WHERE m.cancellation_id=c.id AND (m.status!='SUCCEEDED' OR r.id IS NULL OR r.status!='SUCCEEDED'
          OR r.payment_intent_id!=m.payment_intent_id OR r.amount_minor!=m.required_amount_minor OR r.currency!=m.currency))
  ) SELECT type,orderId,reference,occurredAt FROM notices ORDER BY occurredAt DESC,sortId DESC LIMIT 25`)
    .bind(
      input.customerId,
      now,
      input.customerId,
      now,
      input.customerId,
      input.customerId,
      now,
      now,
    )
    .all<{ type: string; orderId: string | null; reference: string | null; occurredAt: number }>();
  return {
    ok: true,
    requestId: input.requestId,
    value: {
      hasMore: rows.results.length > 24,
      items: rows.results.slice(0, 24).flatMap((row) => {
        const type = customerNotificationTypes.find((candidate) => candidate === row.type);
        if (!type) return [];
        const support = type === "ORDER_REFUND_EXCEPTION";
        return [
          {
            type,
            label: labels[type],
            reference: row.reference ?? "Your order",
            occurredAt: new Date(row.occurredAt).toISOString(),
            href: support
              ? "mailto:support@freshmarkets.ph"
              : row.orderId
                ? `/orders/${encodeURIComponent(row.orderId)}`
                : "/checkout",
            actionLabel: support
              ? "Contact support"
              : row.orderId
                ? "View order"
                : "Review checkout",
          },
        ];
      }),
    },
  };
}
