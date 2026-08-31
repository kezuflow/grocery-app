export const notificationTypes = [
  "ORDER_CONFIRMED",
  "PAYMENT_ACTION_REQUIRED",
  "PAYMENT_FAILED",
  "SCHEDULED_CUTOFF_REMINDER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "DELIVERY_FAILED",
  "RENEWAL_PAYMENT_FAILED",
  "RENEWAL_ACTION_REQUIRED",
  "TRIAL_ENDING",
  "FIRST_PAID_RENEWAL_UPCOMING",
  "ORDER_CANCELLATION_REQUESTED",
  "ORDER_REFUND_PROGRESSING",
  "ORDER_REFUND_COMPLETED",
  "ORDER_CANCELLATION_COMPLETED",
  "ORDER_REFUND_EXCEPTION",
] as const;

export type NotificationType = (typeof notificationTypes)[number];

export function validateNotification(input: {
  type: string;
  recipient: string;
  templateData: Record<string, unknown>;
}) {
  if (!(notificationTypes as readonly string[]).includes(input.type))
    return { ok: false as const, code: "UNKNOWN_TYPE" };
  if (input.recipient.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient))
    return { ok: false as const, code: "INVALID_RECIPIENT" };
  const encoded = JSON.stringify(input.templateData);
  if (encoded.length > 16_384) return { ok: false as const, code: "PAYLOAD_TOO_LARGE" };
  if (/token=|authorization|provider_?reference|staff_?identity|routing_?authority/i.test(encoded))
    return { ok: false as const, code: "UNSAFE_PAYLOAD" };
  return { ok: true as const, type: input.type as NotificationType, encoded };
}

export function projectCancellationNotification(input: {
  state: "REQUESTED" | "REFUNDS_PROCESSING" | "COMPLETED" | "EXCEPTION";
}): { eventType: NotificationType } {
  return {
    eventType: {
      REQUESTED: "ORDER_CANCELLATION_REQUESTED",
      REFUNDS_PROCESSING: "ORDER_REFUND_PROGRESSING",
      COMPLETED: "ORDER_CANCELLATION_COMPLETED",
      EXCEPTION: "ORDER_REFUND_EXCEPTION",
    }[input.state] as NotificationType,
  };
}

export function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}
