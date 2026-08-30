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
};

export function renderEmail(type: NotificationType, data: Record<string, unknown>) {
  const subject = subjects[type];
  const reference = escape(data.orderNumber ?? data.membershipReference ?? "your account");
  const text = `${subject}. Reference: ${String(data.orderNumber ?? data.membershipReference ?? "your account")}.`;
  return {
    subject,
    text,
    html: `<p>${escape(subject)}</p><p>Reference: ${reference}</p>`,
    templateVersion: 1,
  };
}
