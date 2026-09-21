import type { AdminOrderSummary } from "@freshmarkets/contracts";
import { AdminStatusPill, type AdminStatusTone } from "./admin-status-pill";

type StatusFact = Readonly<{
  code: string;
  label: string;
  tone: AdminStatusTone;
}>;

type OrderProgressSource = Pick<
  AdminOrderSummary,
  | "status"
  | "fulfillmentStatus"
  | "deliveryStatus"
  | "deliveryDispatchStatus"
  | "deliveryProviderStatus"
>;

const overridingOrderStatuses: Readonly<Record<string, StatusFact>> = {
  CANCELLATION_REQUESTED: {
    code: "CANCELLATION_REQUESTED",
    label: "Cancellation requested",
    tone: "warning",
  },
  CANCELED: { code: "CANCELED", label: "Canceled", tone: "danger" },
  DELIVERED: { code: "DELIVERED", label: "Delivered", tone: "success" },
  EXPIRED: { code: "EXPIRED", label: "Expired", tone: "neutral" },
  EXCEPTION: { code: "EXCEPTION", label: "Needs attention", tone: "danger" },
};

const fulfillmentStatuses: Readonly<Record<string, StatusFact>> = {
  PICKING: { code: "PICKING", label: "Picking", tone: "info" },
  READY_TO_PACK: { code: "READY_TO_PACK", label: "Ready to pack", tone: "info" },
  PACKING: { code: "PACKING", label: "Packing", tone: "accent" },
  PACKED: { code: "PACKED", label: "Ready for pickup", tone: "success" },
  HANDED_OFF: { code: "HANDED_OFF", label: "Handed to rider", tone: "accent" },
  COMPLETED: { code: "COMPLETED", label: "Fulfillment complete", tone: "success" },
  SHORTED: { code: "SHORTED", label: "Item shortage", tone: "warning" },
  CANCELED: { code: "FULFILLMENT_CANCELED", label: "Fulfillment canceled", tone: "danger" },
  ESCALATED: {
    code: "FULFILLMENT_ESCALATED",
    label: "Fulfillment needs attention",
    tone: "danger",
  },
};

const deliveryStatuses: Readonly<Record<string, StatusFact>> = {
  ASSIGNED: { code: "RIDER_ASSIGNED", label: "Rider assigned", tone: "info" },
  EN_ROUTE: { code: "OUT_FOR_DELIVERY", label: "Out for delivery", tone: "accent" },
  ARRIVED: { code: "RIDER_ARRIVED", label: "Rider arrived", tone: "accent" },
  DELIVERED: { code: "DELIVERED", label: "Delivered", tone: "success" },
  FAILED: { code: "DELIVERY_FAILED", label: "Delivery failed", tone: "danger" },
  RETRY_SCHEDULED: {
    code: "DELIVERY_RETRY_SCHEDULED",
    label: "Courier retry scheduled",
    tone: "warning",
  },
  ESCALATED: { code: "DELIVERY_ESCALATED", label: "Delivery needs attention", tone: "danger" },
  CANCELED: { code: "DELIVERY_CANCELED", label: "Courier canceled", tone: "warning" },
};

const providerStatuses: Readonly<Record<string, StatusFact>> = {
  ALLOCATING: { code: "FINDING_RIDER", label: "Finding rider", tone: "warning" },
  PENDING_PICKUP: { code: "RIDER_ASSIGNED", label: "Rider assigned", tone: "info" },
  PICKING_UP: { code: "RIDER_ASSIGNED", label: "Rider assigned", tone: "info" },
  PENDING_DROP_OFF: { code: "RIDER_ASSIGNED", label: "Rider assigned", tone: "info" },
  IN_DELIVERY: { code: "OUT_FOR_DELIVERY", label: "Out for delivery", tone: "accent" },
  COMPLETED: { code: "DELIVERED", label: "Delivered", tone: "success" },
  IN_RETURN: { code: "DELIVERY_RETURNING", label: "Returning to store", tone: "warning" },
  RETURNED: { code: "DELIVERY_RETURNED", label: "Returned to store", tone: "warning" },
};

const dispatchStatuses: Readonly<Record<string, StatusFact>> = {
  PENDING: { code: "COURIER_REQUEST_PENDING", label: "Courier request pending", tone: "warning" },
  CREATING: { code: "REQUESTING_COURIER", label: "Requesting courier", tone: "warning" },
  ACTIVE: { code: "COURIER_REQUESTED", label: "Courier requested", tone: "warning" },
  RETRY_REQUIRED: {
    code: "COURIER_RETRY_REQUIRED",
    label: "Courier retry required",
    tone: "warning",
  },
  OUTCOME_UNKNOWN: {
    code: "COURIER_STATUS_PENDING",
    label: "Courier status pending",
    tone: "warning",
  },
  RECONCILIATION_REQUIRED: {
    code: "COURIER_REVIEW_REQUIRED",
    label: "Courier needs review",
    tone: "danger",
  },
  FAILED: { code: "COURIER_REQUEST_FAILED", label: "Courier request failed", tone: "danger" },
  CANCELED: { code: "DELIVERY_CANCELED", label: "Courier canceled", tone: "warning" },
  RETURNED: { code: "DELIVERY_RETURNED", label: "Returned to store", tone: "warning" },
  COMPLETED: { code: "DELIVERED", label: "Delivered", tone: "success" },
};

const lifecycleStatuses: Readonly<Record<string, StatusFact>> = {
  PENDING_PAYMENT: { code: "PENDING_PAYMENT", label: "Pending payment", tone: "warning" },
  COMMITTED: { code: "COMMITTED", label: "Committed", tone: "neutral" },
  FULFILLMENT_PENDING: {
    code: "FULFILLMENT_PENDING",
    label: "Fulfillment pending",
    tone: "warning",
  },
  FULFILLMENT_READY: { code: "FULFILLMENT_READY", label: "Ready for pickup", tone: "success" },
  OUT_FOR_DELIVERY: { code: "OUT_FOR_DELIVERY", label: "Out for delivery", tone: "accent" },
};

function deliveryFact(order: OrderProgressSource): StatusFact | null {
  const job = order.deliveryStatus ? deliveryStatuses[order.deliveryStatus] : undefined;
  if (job) return job;

  const provider = order.deliveryProviderStatus
    ? providerStatuses[order.deliveryProviderStatus]
    : undefined;
  if (provider) return provider;

  return order.deliveryDispatchStatus
    ? (dispatchStatuses[order.deliveryDispatchStatus] ?? null)
    : null;
}

/**
 * Composes the three authoritative progress tracks without pretending that
 * packing and courier assignment are one strictly serial state machine.
 */
export function orderProgressFacts(order: OrderProgressSource): ReadonlyArray<StatusFact> {
  const overridingOrderStatus = overridingOrderStatuses[order.status];
  if (overridingOrderStatus) return [overridingOrderStatus];

  const delivery = deliveryFact(order);
  if (delivery && ["OUT_FOR_DELIVERY", "RIDER_ARRIVED", "DELIVERED"].includes(delivery.code)) {
    return [delivery];
  }

  const preparation = order.fulfillmentStatus
    ? fulfillmentStatuses[order.fulfillmentStatus]
    : undefined;
  const facts = [preparation, delivery].filter((fact): fact is StatusFact => Boolean(fact));
  if (facts.length > 0)
    return facts.filter(
      (fact, index) => facts.findIndex((item) => item.code === fact.code) === index,
    );

  return [
    lifecycleStatuses[order.status] ?? {
      code: order.status,
      label: order.status,
      tone: "neutral",
    },
  ];
}

export function OrderProgressStatus({ order }: { order: OrderProgressSource }) {
  const facts = orderProgressFacts(order);
  return (
    <div
      className="flex max-w-52 flex-wrap gap-1.5"
      aria-label={`Order progress: ${facts.map((fact) => fact.label).join("; ")}`}
    >
      {facts.map((fact) => (
        <AdminStatusPill key={fact.code} status={fact.code} label={fact.label} tone={fact.tone} />
      ))}
    </div>
  );
}
