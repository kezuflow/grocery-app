// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentReturnStatus } from "./payment-return-status";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("payment return status", () => {
  it("waits for the exact Core order receipt before confirming a returned payment", async () => {
    vi.useFakeTimers();
    const onCompleted = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          value: { paymentIntentId: "payment-1", state: "FINALIZING_ORDER", orderId: null },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          value: { paymentIntentId: "payment-1", state: "COMPLETED", orderId: "order-1" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await act(async () =>
      root.render(<PaymentReturnStatus paymentIntentId="payment-1" onCompleted={onCompleted} />),
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/checkout/payment/status?paymentIntentId=payment-1",
    );
    expect(container.textContent).toContain("Payment received");
    expect(container.textContent).not.toContain("Order confirmed");
    expect(onCompleted).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(container.textContent).toContain("Order confirmed");
    expect(container.querySelector('a[href="/orders/order-1"]')).not.toBeNull();
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("does not claim success from an unidentifiable return", async () => {
    const onCompleted = vi.fn();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await act(async () =>
      root.render(<PaymentReturnStatus paymentIntentId={null} onCompleted={onCompleted} />),
    );
    expect(container.textContent).toContain("did not include a payment reference");
    expect(fetcher).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
