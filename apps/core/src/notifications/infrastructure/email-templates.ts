import type { NotificationType } from "../domain/notification";

function escape(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

const subjects: Record<NotificationType, string> = {
  STAFF_INVITED: "You are invited to FreshMarkets staff access",
  CUSTOMER_INVITED: "You are invited to FreshMarkets",
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

export function renderEmail(
  type: NotificationType,
  data: Record<string, unknown>,
  applicationOrigin?: string,
) {
  const subject = subjects[type];
  if (type === "STAFF_INVITED" || type === "CUSTOMER_INVITED") {
    if (!applicationOrigin) throw new Error("INVITATION_LINK_NOT_CONFIGURED");
    const origin = new URL(applicationOrigin);
    if (
      origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      )
    )
      throw new Error("INVITATION_LINK_NOT_CONFIGURED");
    const url = new URL(
      type === "STAFF_INVITED" ? "/staff-invitation" : "/customer-invitation",
      origin.origin,
    ).toString();
    if (!Number.isSafeInteger(data.expiresAt) || typeof data.expiresAt !== "number")
      throw new Error("INVALID_INVITATION_TEMPLATE");
    const expiresAt = new Date(data.expiresAt).toISOString();
    const text = `${subject}. Sign in or create an account with this email address, verify your email, then review and accept the invitation: ${url}\nExpires ${expiresAt}.`;
    return {
      subject,
      text,
      html: `<p>${escape(subject)}</p><p>Sign in or create an account with this email address, verify your email, then review and accept the invitation.</p><p><a href="${escape(url)}">Review invitation</a></p><p>Expires ${escape(expiresAt)}.</p>`,
      templateVersion: 1,
    };
  }
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
