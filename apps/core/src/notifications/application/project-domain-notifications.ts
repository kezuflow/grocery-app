import type { NotificationType } from "../domain/notification";
import { enqueueNotification } from "./enqueue-notification";

type Fact = {
  type: NotificationType;
  aggregateType: string;
  aggregateId: string;
  customerId: string;
  recipient: string;
  reference: string;
  scheduledAt: number;
  identity: string;
};

export async function projectDomainNotifications(
  database: D1Database,
  now: number,
): Promise<number> {
  const facts: Fact[] = [];
  const orders = await database
    .prepare(
      `SELECT o.id,o.customer_id customerId,u.email,o.order_number orderNumber,o.committed_at,
            o.fulfillment_mode,ofs.cutoff_at,d.status deliveryStatus,d.updated_at deliveryUpdatedAt
     FROM grocery_order o JOIN customer c ON c.id=o.customer_id JOIN user u ON u.id=c.auth_user_id
     LEFT JOIN order_fulfillment_snapshot ofs ON ofs.order_id=o.id
     LEFT JOIN delivery_job d ON d.order_id=o.id WHERE o.committed_at IS NOT NULL`,
    )
    .all<{
      id: string;
      customerId: string;
      email: string;
      orderNumber: string | null;
      committed_at: number;
      fulfillment_mode: string;
      cutoff_at: number | null;
      deliveryStatus: string | null;
      deliveryUpdatedAt: number | null;
    }>();
  for (const order of orders.results) {
    facts.push({
      type: "ORDER_CONFIRMED",
      aggregateType: "ORDER",
      aggregateId: order.id,
      customerId: order.customerId,
      recipient: order.email,
      reference: order.orderNumber ?? order.id,
      scheduledAt: order.committed_at,
      identity: `order-confirmed:${order.id}`,
    });
    if (order.fulfillment_mode === "SCHEDULED" && order.cutoff_at && order.cutoff_at > now)
      facts.push({
        type: "SCHEDULED_CUTOFF_REMINDER",
        aggregateType: "ORDER",
        aggregateId: order.id,
        customerId: order.customerId,
        recipient: order.email,
        reference: order.orderNumber ?? order.id,
        scheduledAt: Math.max(now, order.cutoff_at - 24 * 60 * 60_000),
        identity: `cutoff-reminder:${order.id}:${order.cutoff_at}`,
      });
    const deliveryType =
      order.deliveryStatus === "DISPATCHED"
        ? "OUT_FOR_DELIVERY"
        : order.deliveryStatus === "DELIVERED"
          ? "DELIVERED"
          : ["FAILED", "DELIVERY_FAILED"].includes(order.deliveryStatus ?? "")
            ? "DELIVERY_FAILED"
            : null;
    if (deliveryType && order.deliveryUpdatedAt)
      facts.push({
        type: deliveryType,
        aggregateType: "DELIVERY",
        aggregateId: order.id,
        customerId: order.customerId,
        recipient: order.email,
        reference: order.orderNumber ?? order.id,
        scheduledAt: order.deliveryUpdatedAt,
        identity: `delivery:${order.id}:${deliveryType}:${order.deliveryUpdatedAt}`,
      });
  }
  const payments = await database
    .prepare(
      `SELECT pi.id,pi.customer_id customerId,u.email,pi.purpose,pi.status,pi.updated_at
     FROM payment_intent pi JOIN customer c ON c.id=pi.customer_id JOIN user u ON u.id=c.auth_user_id
     WHERE pi.status IN ('REQUIRES_ACTION','FAILED')`,
    )
    .all<{
      id: string;
      customerId: string;
      email: string;
      purpose: string;
      status: string;
      updated_at: number;
    }>();
  for (const payment of payments.results) {
    const renewal = payment.purpose === "MEMBERSHIP_RENEWAL";
    const type: NotificationType =
      payment.status === "REQUIRES_ACTION"
        ? renewal
          ? "RENEWAL_ACTION_REQUIRED"
          : "PAYMENT_ACTION_REQUIRED"
        : renewal
          ? "RENEWAL_PAYMENT_FAILED"
          : "PAYMENT_FAILED";
    facts.push({
      type,
      aggregateType: "PAYMENT",
      aggregateId: payment.id,
      customerId: payment.customerId,
      recipient: payment.email,
      reference: "your account",
      scheduledAt: payment.updated_at,
      identity: `payment:${payment.id}:${type}:${payment.updated_at}`,
    });
  }
  const subscriptions = await database
    .prepare(
      `SELECT s.id,s.customer_id customerId,u.email,s.status,s.trial_ends_at,s.ends_at
     FROM subscription s JOIN customer c ON c.id=s.customer_id JOIN user u ON u.id=c.auth_user_id
     WHERE (s.status='TRIALING' AND s.trial_ends_at IS NOT NULL) OR (s.status='ACTIVE' AND s.ends_at IS NOT NULL)`,
    )
    .all<{
      id: string;
      customerId: string;
      email: string;
      status: string;
      trial_ends_at: number | null;
      ends_at: number | null;
    }>();
  for (const subscription of subscriptions.results) {
    const end =
      subscription.status === "TRIALING" ? subscription.trial_ends_at : subscription.ends_at;
    if (!end) continue;
    const type: NotificationType =
      subscription.status === "TRIALING" ? "TRIAL_ENDING" : "FIRST_PAID_RENEWAL_UPCOMING";
    facts.push({
      type,
      aggregateType: "SUBSCRIPTION",
      aggregateId: subscription.id,
      customerId: subscription.customerId,
      recipient: subscription.email,
      reference: subscription.id,
      scheduledAt: Math.max(now, end - 3 * 24 * 60 * 60_000),
      identity: `membership:${subscription.id}:${type}:${end}`,
    });
  }
  let inserted = 0;
  for (const fact of facts) {
    const before = await database
      .prepare("SELECT 1 found FROM notification_outbox WHERE idempotency_key=?")
      .bind(fact.identity)
      .first();
    const result = await enqueueNotification(database, {
      type: fact.type,
      aggregateType: fact.aggregateType,
      aggregateId: fact.aggregateId,
      customerId: fact.customerId,
      recipient: fact.recipient,
      templateData: {
        orderNumber: fact.reference,
        membershipReference: fact.reference,
        templateVersion: 1,
      },
      scheduledAt: fact.scheduledAt,
      idempotencyKey: fact.identity,
    });
    if (!before && result.ok) inserted++;
  }
  return inserted;
}
