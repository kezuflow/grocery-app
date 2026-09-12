export const invitationEmailStatuses = [
  "NOT_REQUESTED",
  "QUEUED",
  "SENDING",
  "ACCEPTED",
  "FAILED",
  "OUTCOME_UNKNOWN",
  "CANCELED",
] as const;
export type InvitationEmailStatus = (typeof invitationEmailStatuses)[number];

export const customerNotificationTypes = [
  "ORDER_CONFIRMED",
  "PAYMENT_ACTION_REQUIRED",
  "PAYMENT_FAILED",
  "SCHEDULED_CUTOFF_REMINDER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "DELIVERY_FAILED",
  "ORDER_CANCELLATION_REQUESTED",
  "ORDER_REFUND_PROGRESSING",
  "ORDER_REFUND_COMPLETED",
  "ORDER_CANCELLATION_COMPLETED",
  "ORDER_REFUND_EXCEPTION",
] as const;
export type CustomerNotificationType = (typeof customerNotificationTypes)[number];
/** A customer-safe projection; no delivery metadata or persisted read state. */
export type CustomerNotification = {
  type: CustomerNotificationType;
  label: string;
  reference: string;
  occurredAt: string;
  href: string;
  actionLabel: string;
};
export type CustomerNotificationsView = {
  items: readonly CustomerNotification[];
  hasMore: boolean;
};
