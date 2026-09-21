// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayMongoPayment } from "@/components/payments/paymongo-payment";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("PayMongoPayment", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sessionStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("automatically creates QR Ph with PayMongo's documented expiry and refreshes it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T01:00:00.000Z"));
    sessionStorage.setItem(
      "checkout-action",
      JSON.stringify({
        paymentIntentId: "payment-1",
        paymentMethod: { kind: "TOKEN", value: "qrph" },
        providerReference: "pi_1",
        actionType: "SDK",
        clientToken: "pi_1_client_secret",
        expiresAt: new Date(Date.now() + 61 * 60_000).toISOString(),
      }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true, value: { publicKey: "pk_test_public" } }))
      .mockResolvedValueOnce(
        Response.json({ data: { id: "pm_qrph", type: "payment_method", attributes: {} } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            id: "pi_1",
            attributes: { next_action: { code: { image_url: "data:image/png;base64,first" } } },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { id: "pm_qrph_refresh", type: "payment_method", attributes: {} } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            id: "pi_1",
            attributes: { next_action: { code: { image_url: "data:image/png;base64,second" } } },
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);

    await act(async () =>
      root.render(
        <PayMongoPayment
          storageKey="checkout-action"
          title="Complete payment"
          description="Secure payment"
          returnPath="/orders?payment=return"
          donePath="/orders?payment=submitted"
          backPath="/orders?payment=return"
        />,
      ),
    );
    await flush();
    await flush();

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.paymongo.com/v1/payment_methods",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      data: { attributes: { type: "qrph", expiry_seconds: 1800 } },
    });
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toMatchObject({
      data: { attributes: { payment_method: "pm_qrph", client_key: "pi_1_client_secret" } },
    });
    expect(container.querySelector('img[alt="QR Ph payment code"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,first",
    );
    expect(container.querySelector('[role="timer"]')?.textContent).toContain("Refreshes in 30:00");

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.querySelector('[role="timer"]')?.textContent).toContain("Refreshes in 29:59");

    await act(async () => vi.advanceTimersByTimeAsync(29 * 60_000 + 59_000));
    await flush();
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toMatchObject({
      data: { attributes: { type: "qrph", expiry_seconds: 1800 } },
    });
    expect(container.querySelector('img[alt="QR Ph payment code"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,second",
    );
    expect(container.querySelector('[role="timer"]')?.textContent).toContain("Refreshes in 30:00");
    expect(container.textContent).toContain("confirm the order after PayMongo reports payment");
  });

  it("restores an unexpired QR Ph code without attaching another method", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T02:00:00.000Z"));
    sessionStorage.setItem(
      "checkout-action",
      JSON.stringify({
        paymentIntentId: "payment-1",
        paymentMethod: { kind: "TOKEN", value: "qrph" },
        providerReference: "pi_1",
        actionType: "SDK",
        clientToken: "pi_1_client_secret",
        expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
        qrCode: "data:image/png;base64,persisted",
        qrCodeExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ ok: true, value: { publicKey: "pk_test_public" } }));
    vi.stubGlobal("fetch", fetcher);

    await act(async () =>
      root.render(
        <PayMongoPayment
          storageKey="checkout-action"
          title="Complete payment"
          description="Secure payment"
          returnPath="/orders?payment=return"
          donePath="/orders?payment=submitted"
          backPath="/orders?payment=return"
        />,
      ),
    );
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img[alt="QR Ph payment code"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,persisted",
    );
    expect(container.querySelector('[role="timer"]')?.textContent).toContain("Refreshes in 10:00");
  });
});
