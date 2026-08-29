// Closed lifecycle vocabularies derived from docs/architecture/STATE_MACHINES.md.
// State unions must be derived from these arrays so new states require an
// explicit canonical documentation change.

export const subscriptionStates = [
  "PENDING",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
  "EXPIRED",
] as const;

export type SubscriptionState = (typeof subscriptionStates)[number];

export const paymentStates = [
  "INITIATED",
  "REQUIRES_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export type PaymentState = (typeof paymentStates)[number];

export const refundStates = [
  "REQUESTED",
  "APPROVED",
  "PROCESSING",
  "SUCCEEDED",
  "REJECTED",
  "FAILED",
  "ESCALATED",
] as const;

export type RefundState = (typeof refundStates)[number];

export const procurementStates = [
  "OPEN",
  "AGGREGATED",
  "REQUIREMENT_APPROVED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "EXCEPTION",
] as const;
export type ProcurementState = (typeof procurementStates)[number];

export const fulfillmentStates = [
  "NOT_STARTED",
  "PICKING",
  "READY_TO_PACK",
  "PACKING",
  "PACKED",
  "HANDED_OFF",
  "COMPLETED",
  "SHORTED",
  "CANCELED",
  "ESCALATED",
] as const;
export type FulfillmentState = (typeof fulfillmentStates)[number];

export const fulfillmentActions = [
  "START_PICKING",
  "MARK_READY_TO_PACK",
  "START_PACKING",
  "MARK_PACKED",
  "HAND_OFF",
  "COMPLETE",
  "RECORD_SHORTAGE",
  "RESUME_PICKING",
  "RESUME_READY_TO_PACK",
  "CANCEL",
  "ESCALATE",
] as const;
export type FulfillmentAction = (typeof fulfillmentActions)[number];

export const deliveryJobStates = [
  "UNASSIGNED",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "DELIVERED",
  "FAILED",
  "RETRY_SCHEDULED",
  "ESCALATED",
  "CANCELED",
] as const;
export type DeliveryJobState = (typeof deliveryJobStates)[number];

export const deliveryActions = [
  "MARK_EN_ROUTE",
  "MARK_ARRIVED",
  "MARK_DELIVERED",
  "MARK_FAILED",
  "SCHEDULE_RETRY",
  "ESCALATE",
  "CANCEL",
] as const;
export type DeliveryAction = (typeof deliveryActions)[number];

// Canonical order lifecycle. Implemented compatibility orders still carry
// legacy operational statuses until Plan 07 replaces the order machine; see
// implementedOrderStates.
export const orderStates = [
  "PENDING_PAYMENT",
  "COMMITTED",
  "FULFILLMENT_PENDING",
  "FULFILLMENT_READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLATION_REQUESTED",
  "CANCELED",
  "EXPIRED",
  "EXCEPTION",
] as const;

export type OrderState = (typeof orderStates)[number];

// Legacy statuses produced by the compatibility order/fulfillment/delivery
// commands. Removed when Plan 07 supplies the canonical order lifecycle.
export const implementedOrderStates = [
  "COMMITTED",
  "IN_FULFILLMENT",
  "PACKED",
  "DISPATCHED",
  "DELIVERED",
  "DELIVERY_FAILED",
  "CANCELED",
  "REFUNDED",
] as const;

export type ImplementedOrderState = (typeof implementedOrderStates)[number];

// Statuses the compatibility operations commands actually return today.
// Narrowed when Plan 08 introduces canonical operations commands.
export const operationsCommandStates = [
  ...procurementStates,
  ...fulfillmentStates,
  ...deliveryJobStates,
] as const;

export type OperationsCommandState = (typeof operationsCommandStates)[number];

export const deliveryCycleStates = [
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "CUTOFF_REACHED",
  "PROCUREMENT",
  "RECEIVING",
  "PACKING",
  "DISPATCHING",
  "DELIVERING",
  "CLOSED",
  "CANCELED",
] as const;

export type DeliveryCycleState = (typeof deliveryCycleStates)[number];

export const receivingRecordStates = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "DISCREPANCY",
  "COMPLETED",
  "CANCELED",
] as const;

export type ReceivingRecordState = (typeof receivingRecordStates)[number];

export const customerAddressStatuses = ["active", "disabled"] as const;

export type CustomerAddressStatus = (typeof customerAddressStatuses)[number];
