import { log } from "../observability";

export type AuthEmailMessage = {
  kind: "verification" | "reset";
  recipient: string;
  url: string;
};

export type AuthEmailDelivery = {
  send(message: AuthEmailMessage): Promise<void>;
};

export type AuthEmailBindingEnvironment = {
  EMAIL?: SendEmail;
  AUTH_EMAIL_FROM?: string;
  ENVIRONMENT?: string;
};

export class UnavailableAuthEmailDelivery implements AuthEmailDelivery {
  async send(message: AuthEmailMessage): Promise<void> {
    log("warn", `auth.email.${message.kind}.unavailable`, {
      kind: message.kind,
      configured: false,
    });
    throw new Error("AUTH_EMAIL_DELIVERY_UNCONFIGURED");
  }
}

export function createAuthEmailDelivery(
  sender: (message: AuthEmailMessage) => Promise<void>,
): AuthEmailDelivery {
  return {
    async send(message) {
      await sender(message);
      log("info", `auth.email.${message.kind}.sent`, { kind: message.kind });
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createCloudflareAuthEmailDelivery(
  env: AuthEmailBindingEnvironment,
): AuthEmailDelivery {
  const sender = env.AUTH_EMAIL_FROM?.trim();
  if (!env.EMAIL || !sender) return new UnavailableAuthEmailDelivery();

  return createAuthEmailDelivery(async (message) => {
    const verification = message.kind === "verification";
    const subject = verification
      ? "Verify your FreshMarkets email"
      : "Reset your FreshMarkets password";
    const action = verification ? "verify your email" : "reset your password";
    const safeUrl = escapeHtml(message.url);

    await env.EMAIL!.send({
      to: message.recipient,
      from: { email: sender, name: "FreshMarkets" },
      subject,
      text: `Use this link to ${action}: ${message.url}`,
      html: `<p>Use the link below to ${action}.</p><p><a href="${safeUrl}">${safeUrl}</a></p>`,
    });
  });
}

export function createRuntimeAuthEmailDelivery(
  env: AuthEmailBindingEnvironment,
): AuthEmailDelivery {
  if (env.ENVIRONMENT === "test") return createAuthEmailDelivery(async () => undefined);
  return createCloudflareAuthEmailDelivery(env);
}
