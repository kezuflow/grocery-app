import { describe, expect, it, vi } from "vitest";
import { createCloudflareEmailDeliveryPort } from "./email-delivery-port";

describe("Cloudflare transactional email delivery port", () => {
  it("bounds an unresolved provider send and never assumes failure", async () => {
    vi.useFakeTimers();
    try {
      const port = createCloudflareEmailDeliveryPort({
        AUTH_EMAIL_FROM: "orders@example.com",
        EMAIL: { send: () => new Promise<EmailSendResult>(() => {}) },
      });
      const result = port.send({
        recipient: "customer@example.com",
        subject: "Subject",
        text: "Text",
        html: "<p>Text</p>",
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await result).toEqual({ ok: false, code: "SEND_OUTCOME_UNKNOWN", outcome: "UNKNOWN" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not persist arbitrary provider error content", async () => {
    const port = createCloudflareEmailDeliveryPort({
      AUTH_EMAIL_FROM: "orders@example.com",
      EMAIL: {
        send: async () => {
          throw { code: "private@example.com bearer-secret" };
        },
      },
    });
    expect(
      await port.send({
        recipient: "customer@example.com",
        subject: "Subject",
        text: "Text",
        html: "<p>Text</p>",
      }),
    ).toEqual({ ok: false, code: "SEND_OUTCOME_UNKNOWN", outcome: "UNKNOWN" });
  });
  it("treats a network error after provider acceptance as unknown", async () => {
    let accepted = 0;
    const port = createCloudflareEmailDeliveryPort({
      AUTH_EMAIL_FROM: "orders@example.com",
      EMAIL: {
        async send() {
          accepted += 1;
          throw new Error("Response lost after acceptance");
        },
      },
    });
    expect(
      await port.send({
        recipient: "customer@example.com",
        subject: "Invitation",
        text: "Invitation",
        html: "<p>Invitation</p>",
      }),
    ).toMatchObject({ ok: false, outcome: "UNKNOWN" });
    expect(accepted).toBe(1);
  });
  it("sends both text and html through the configured binding", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "message-1" });
    const port = createCloudflareEmailDeliveryPort({
      EMAIL: { send },
      AUTH_EMAIL_FROM: "orders@getscenepass.com",
    });
    await expect(
      port.send({
        recipient: "customer@example.com",
        subject: "Order confirmed",
        text: "Your order is confirmed.",
        html: "<p>Your order is confirmed.</p>",
      }),
    ).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({
      to: "customer@example.com",
      from: { email: "orders@getscenepass.com", name: "FreshMarkets" },
      subject: "Order confirmed",
      text: "Your order is confirmed.",
      html: "<p>Your order is confirmed.</p>",
    });
  });

  it("fails closed without a binding/sender and preserves provider error codes", async () => {
    await expect(
      createCloudflareEmailDeliveryPort({}).send({
        recipient: "customer@example.com",
        subject: "Subject",
        text: "Text",
        html: "<p>Text</p>",
      }),
    ).resolves.toEqual({ ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED", outcome: "NOT_SENT" });

    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("limited"), { code: "E_RATE_LIMIT_EXCEEDED" }));
    const port = createCloudflareEmailDeliveryPort({
      EMAIL: { send },
      AUTH_EMAIL_FROM: "orders@getscenepass.com",
    });
    await expect(
      port.send({
        recipient: "customer@example.com",
        subject: "Subject",
        text: "Text",
        html: "<p>Text</p>",
      }),
    ).resolves.toEqual({ ok: false, code: "E_RATE_LIMIT_EXCEEDED", outcome: "NOT_SENT" });
  });
});
