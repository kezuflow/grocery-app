export type TransactionalEmail = { recipient: string; subject: string; text: string; html: string };
export type EmailSendOutcome =
  | { ok: true }
  | { ok: false; code: string; outcome: "NOT_SENT" | "UNKNOWN" };
export interface EmailDeliveryPort {
  send(message: TransactionalEmail): Promise<EmailSendOutcome>;
}
export type EmailDeliveryEnvironment = {
  EMAIL?: Pick<SendEmail, "send">;
  AUTH_EMAIL_FROM?: string;
};
export const disabledEmailDeliveryPort: EmailDeliveryPort = {
  async send() {
    return { ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED", outcome: "NOT_SENT" };
  },
};

const rejectedBeforeSending = new Set([
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_TOO_MANY_ATTACHMENTS",
  "E_SENDER_NOT_VERIFIED",
  "E_RECIPIENT_NOT_ALLOWED",
  "E_RECIPIENT_SUPPRESSED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
  "E_CONTENT_TOO_LARGE",
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_HEADER_NOT_ALLOWED",
  "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID",
  "E_HEADER_VALUE_TOO_LONG",
  "E_HEADER_NAME_INVALID",
  "E_HEADERS_TOO_LARGE",
  "E_HEADERS_TOO_MANY",
]);
function providerFailure(error: unknown): EmailSendOutcome {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    rejectedBeforeSending.has(error.code)
  )
    return { ok: false, code: error.code, outcome: "NOT_SENT" };
  return { ok: false, code: "SEND_OUTCOME_UNKNOWN", outcome: "UNKNOWN" };
}

export function createCloudflareEmailDeliveryPort(
  env: EmailDeliveryEnvironment,
): EmailDeliveryPort {
  const email = env.EMAIL;
  const sender = env.AUTH_EMAIL_FROM?.trim();
  if (!email || !sender) return disabledEmailDeliveryPort;
  return {
    async send(message) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          email.send({
            to: message.recipient,
            from: { email: sender, name: "FreshMarkets" },
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("EMAIL_SEND_TIMEOUT")), 30_000);
          }),
        ]);
        if (!response || typeof response.messageId !== "string" || !response.messageId.trim())
          return { ok: false, code: "SEND_OUTCOME_UNKNOWN", outcome: "UNKNOWN" };
        return { ok: true };
      } catch (error) {
        return providerFailure(error);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}
