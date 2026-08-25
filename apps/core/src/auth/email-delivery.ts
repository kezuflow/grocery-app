import { log } from "../observability";

export type AuthEmailMessage = {
  kind: "verification" | "reset";
  recipient: string;
  url: string;
};

export type AuthEmailDelivery = {
  send(message: AuthEmailMessage): Promise<void>;
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
