// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayMongoPayment } from "@/components/payments/paymongo-payment";
import { PaymentSuccessAnimation } from "@/components/payments/payment-success-animation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@lottiefiles/dotlottie-react", () => ({
  DotLottieReact: ({ src }: { src: string }) => (
    <canvas aria-hidden="true" data-animation-src={src} />
  ),
  setWasmUrl: vi.fn(),
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
    vi.restoreAllMocks();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("offers authenticated payment recovery when browser storage cannot be read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

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

    expect(container.textContent).toContain("payment setup is missing");
    expect(container.querySelector('a[href="/orders?payment=return"]')).not.toBeNull();
  });

  it.each(["closed", "unavailable", "missing-decision"])(
    "blocks QR generation when current Core eligibility is %s",
    async (scenario) => {
      sessionStorage.setItem(
        "checkout-action",
        JSON.stringify({
          paymentIntentId: "payment-1",
          paymentMethod: { kind: "TOKEN", value: "qrph" },
          actionType: "SDK",
          clientToken: "pi_1_client_test",
          expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
          // Deliberately no stored cutoff: current Core eligibility must still protect recovery.
        }),
      );
      const fetcher = vi.fn((url: string) =>
        Promise.resolve(
          url === "/api/checkout/payment"
            ? Response.json({ ok: true, value: { publicKey: "pk_test_public" } })
            : scenario === "unavailable"
              ? Response.json({ ok: false, error: { code: "UNAVAILABLE" } }, { status: 503 })
              : Response.json({
                  ok: true,
                  value: {
                    paymentIntentId: "payment-1",
                    state: "WAITING_FOR_PAYMENT",
                    orderId: null,
                    ...(scenario === "closed"
                      ? { qrGenerationAllowed: false, qrGenerationEndsAt: null }
                      : {}),
                  },
                }),
        ),
      );
      vi.stubGlobal("fetch", fetcher);
      await act(async () =>
        root.render(
          <PayMongoPayment
            storageKey="checkout-action"
            title="Complete payment"
            description="Secure payment"
            returnPath="/orders"
            donePath="/orders"
            backPath="/orders"
            completionStatusPath="/api/checkout/payment/status"
          />,
        ),
      );
      await flush();
      expect(
        fetcher.mock.calls.every(([url]) => !String(url).startsWith("https://api.paymongo.com")),
      ).toBe(true);
      expect(container.textContent).toContain(
        scenario === "unavailable"
          ? "eligibility could not be checked"
          : "No new QR code can be created",
      );
    },
  );

  it("rechecks Core after method creation and does not attach when ordering closes in flight", async () => {
    sessionStorage.setItem(
      "checkout-action",
      JSON.stringify({
        paymentIntentId: "payment-1",
        paymentMethod: { kind: "TOKEN", value: "qrph" },
        actionType: "SDK",
        clientToken: "pi_1_client_test",
        expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
      }),
    );
    let closed = false;
    const fetcher = vi.fn((url: string) => {
      if (url === "/api/checkout/payment")
        return Promise.resolve(Response.json({ ok: true, value: { publicKey: "pk_test_public" } }));
      if (url.startsWith("/api/checkout/payment/status"))
        return Promise.resolve(
          Response.json({
            ok: true,
            value: {
              paymentIntentId: "payment-1",
              state: "WAITING_FOR_PAYMENT",
              orderId: null,
              qrGenerationAllowed: !closed,
              qrGenerationEndsAt: null,
            },
          }),
        );
      if (url.endsWith("/payment_methods")) {
        closed = true;
        return Promise.resolve(Response.json({ data: { id: "pm_test" } }));
      }
      throw new Error("Unexpected provider attach");
    });
    vi.stubGlobal("fetch", fetcher);
    await act(async () =>
      root.render(
        <PayMongoPayment
          storageKey="checkout-action"
          title="Complete payment"
          description="Secure payment"
          returnPath="/orders"
          donePath="/orders"
          backPath="/orders"
          completionStatusPath="/api/checkout/payment/status"
        />,
      ),
    );
    await flush();
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).startsWith("https://api.paymongo.com")),
    ).toHaveLength(1);
    expect(container.textContent).toContain("No new QR code can be created");
  });

  it("keeps a generated QR usable when browser storage cannot be written", async () => {
    sessionStorage.setItem(
      "checkout-action",
      JSON.stringify({
        paymentIntentId: "payment-1",
        paymentMethod: { kind: "TOKEN", value: "qrph" },
        providerReference: "pi_1",
        actionType: "SDK",
        clientToken: "pi_1_client_secret",
        expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
      }),
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ok: true, value: { publicKey: "pk_test_public" } }))
        .mockResolvedValueOnce(Response.json({ data: { id: "pm_qrph", attributes: {} } }))
        .mockResolvedValueOnce(
          Response.json({
            data: {
              id: "pi_1",
              attributes: { next_action: { code: { image_url: "data:image/png;base64,first" } } },
            },
          }),
        ),
    );

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

    expect(container.querySelector('img[alt="QR Ph payment code"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,first",
    );
    expect(
      container.querySelector('a[href="/orders?payment=submitted&paymentIntentId=payment-1"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("storage unavailable");
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

  it("keeps an issued QR usable after cutoff but never renews it", async () => {
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
        qrGenerationEndsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true, value: { publicKey: "pk_test_public" } }))
      .mockResolvedValueOnce(Response.json({ data: { id: "pm_qrph", attributes: {} } }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            id: "pi_1",
            attributes: { next_action: { code: { image_url: "data:image/png;base64,first" } } },
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
    expect(container.querySelector('img[alt="QR Ph payment code"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(6 * 60_000));
    expect(container.querySelector('img[alt="QR Ph payment code"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(24 * 60_000));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("No new QR code can be created");
  });

  it("shows finalization before playing success once the order commitment exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T03:00:00.000Z"));
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    sessionStorage.setItem(
      "checkout-action",
      JSON.stringify({
        paymentIntentId: "payment-paid",
        paymentMethod: { kind: "TOKEN", value: "qrph" },
        providerReference: "pi_paid",
        actionType: "SDK",
        clientToken: "pi_paid_client_secret",
        expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
        qrCode: "data:image/png;base64,persisted",
        qrCodeExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true, value: { publicKey: "pk_test_public" } }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          value: {
            paymentIntentId: "payment-paid",
            state: "FINALIZING_ORDER",
            orderId: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          value: {
            paymentIntentId: "payment-paid",
            state: "COMPLETED",
            orderId: "order-123",
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
          completionStatusPath="/api/checkout/payment/status"
        />,
      ),
    );
    await flush();
    await flush();

    expect(container.textContent).toContain("Payment received");
    expect(container.textContent).not.toContain("Payment successful");
    expect(container.querySelector('img[alt="QR Ph payment code"]')).toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await flush();

    expect(container.textContent).toContain("Payment successful");
    expect(container.textContent).toContain("Your order is confirmed.");
    expect(
      container.querySelector('canvas[data-animation-src="/animations/payment-success.lottie"]'),
    ).not.toBeNull();
    expect(container.querySelector('a[href="/orders/order-123"]')?.textContent).toBe("View order");
    expect(sessionStorage.getItem("checkout-action")).toBeNull();
  });

  it("uses a static success mark when the customer prefers reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );

    await act(async () => root.render(<PaymentSuccessAnimation />));
    await flush();

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
});
