import { describe, expect, it, vi } from "vitest";
import { createCloudflareEmailDeliveryPort } from "./email-delivery-port";

describe("Cloudflare transactional email delivery port", () => {
  it("sends both text and html through the configured binding", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "message-1" });
    const port = createCloudflareEmailDeliveryPort({
      EMAIL: { send } as unknown as SendEmail,
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
    ).resolves.toEqual({ ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED" });

    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("limited"), { code: "E_RATE_LIMIT_EXCEEDED" }));
    const port = createCloudflareEmailDeliveryPort({
      EMAIL: { send } as unknown as SendEmail,
      AUTH_EMAIL_FROM: "orders@getscenepass.com",
    });
    await expect(
      port.send({
        recipient: "customer@example.com",
        subject: "Subject",
        text: "Text",
        html: "<p>Text</p>",
      }),
    ).resolves.toEqual({ ok: false, code: "E_RATE_LIMIT_EXCEEDED" });
  });
});
