export type TransactionalEmail = { recipient: string; subject: string; text: string; html: string };
export interface EmailDeliveryPort {
  send(message: TransactionalEmail): Promise<{ ok: true } | { ok: false; code: string }>;
}
export const disabledEmailDeliveryPort: EmailDeliveryPort = {
  async send() {
    return { ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED" };
  },
};
