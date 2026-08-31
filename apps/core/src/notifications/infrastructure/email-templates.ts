import type { NotificationType } from "../domain/notification";

function escape(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

const subjects: Record<NotificationType, string> = {
  ORDER_CONFIRMED: "Your FreshMarkets order is confirmed",
  PAYMENT_ACTION_REQUIRED: "Action needed for your FreshMarkets payment",
  PAYMENT_FAILED: "Your FreshMarkets payment needs attention",
  SCHEDULED_CUTOFF_REMINDER: "Your scheduled order cutoff is approaching",
  OUT_FOR_DELIVERY: "Your FreshMarkets order is out for delivery",
  DELIVERED: "Your FreshMarkets order was delivered",
  DELIVERY_FAILED: "We could not complete your delivery",
  RENEWAL_PAYMENT_FAILED: "Your membership renewal needs attention",
  RENEWAL_ACTION_REQUIRED: "Action needed for your membership renewal",
  TRIAL_ENDING: "Your FreshMarkets introductory trial is ending",
  FIRST_PAID_RENEWAL_UPCOMING: "Your first paid membership renewal is coming up",
  ORDER_CANCELLATION_REQUESTED: "We received your FreshMarkets cancellation request",
  ORDER_REFUND_PROGRESSING: "Your FreshMarkets refund is processing",
  ORDER_REFUND_COMPLETED: "Your FreshMarkets refund was completed",
  ORDER_CANCELLATION_COMPLETED: "Your FreshMarkets order cancellation is complete",
  ORDER_REFUND_EXCEPTION: "Your FreshMarkets refund needs support review",
};

export function renderEmail(type: NotificationType, data: Record<string, unknown>) {
  const subject = subjects[type];
  const reference = escape(data.orderNumber ?? data.membershipReference ?? "your account");
  const rawReference = String(data.orderNumber ?? data.membershipReference ?? "your account");
  const amount =
    Number.isSafeInteger(data.amountMinor) && typeof data.currency === "string"
      ? ` Amount: ${data.currency} ${(Number(data.amountMinor) / 100).toFixed(2)}.`
      : "";
  const support = type === "ORDER_REFUND_EXCEPTION" ? " FreshMarkets support will review it." : "";
  const text = `${subject}. Reference: ${rawReference}.${amount}${support}`;
  return {
    subject,
    text,
    html: `<p>${escape(subject)}</p><p>Reference: ${reference}</p>${amount ? `<p>${escape(amount.trim())}</p>` : ""}${support ? `<p>${escape(support.trim())}</p>` : ""}`,
    templateVersion: 1,
  };
}
