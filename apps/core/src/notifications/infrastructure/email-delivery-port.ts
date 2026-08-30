export type TransactionalEmail = { recipient: string; subject: string; text: string; html: string };
export interface EmailDeliveryPort {
  send(message: TransactionalEmail): Promise<{ ok: true } | { ok: false; code: string }>;
}
export type EmailDeliveryEnvironment = {
  EMAIL?: SendEmail;
  AUTH_EMAIL_FROM?: string;
};
export const disabledEmailDeliveryPort: EmailDeliveryPort = {
  async send() {
    return { ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED" };
  },
};

function providerErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  )
    return error.code.slice(0, 100);
  return "EMAIL_DELIVERY_FAILED";
}

export function createCloudflareEmailDeliveryPort(
  env: EmailDeliveryEnvironment,
): EmailDeliveryPort {
  const email = env.EMAIL;
  const sender = env.AUTH_EMAIL_FROM?.trim();
  if (!email || !sender) return disabledEmailDeliveryPort;
  return {
    async send(message) {
      try {
        await email.send({
          to: message.recipient,
          from: { email: sender, name: "FreshMarkets" },
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, code: providerErrorCode(error) };
      }
    },
  };
}
