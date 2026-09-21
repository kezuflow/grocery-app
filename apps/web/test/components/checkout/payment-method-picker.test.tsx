// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentMethodPicker } from "@/components/storefront/checkout/payment-method-picker";

vi.mock("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

describe("PaymentMethodPicker", () => {
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
    vi.unstubAllGlobals();
  });

  it("allows QR Ph and keeps methods awaiting PayMongo activation disabled", async () => {
    const onSelect = vi.fn();
    await act(async () => root.render(<PaymentMethodPicker selected={null} onSelect={onSelect} />));

    const qrPh = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("QR Ph"),
    );
    const gcash = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("GCash"),
    );
    expect(qrPh?.disabled).toBe(false);
    expect(gcash?.disabled).toBe(true);
    expect(
      [...container.querySelectorAll("img")].map((image) => image.getAttribute("src")),
    ).toEqual([
      "/payment-methods/qr-ph.svg",
      "/payment-methods/gcash.svg",
      "/payment-methods/maya.svg",
      "/payment-methods/grabpay.svg",
      "/payment-methods/shopeepay.svg",
      "/payment-methods/visa-mastercard.svg",
      "/payment-methods/google-pay.svg",
      "/payment-methods/bdo.svg",
      "/payment-methods/bpi.svg",
      "/payment-methods/landbank.svg",
      "/payment-methods/metrobank.svg",
      "/payment-methods/rcbc.svg",
      "/payment-methods/unionbank.svg",
    ]);

    await act(async () => qrPh?.click());
    expect(onSelect).toHaveBeenCalledWith({ kind: "TOKEN", value: "qrph" });
  });

  it("lays out boxed methods in an automatically wrapping row", async () => {
    await act(async () =>
      root.render(
        <PaymentMethodPicker selected={{ kind: "TOKEN", value: "qrph" }} onSelect={vi.fn()} />,
      ),
    );

    const group = container.querySelector('[role="radiogroup"]');
    const methods = [...container.querySelectorAll('[role="radio"]')];

    expect(group?.className).toContain(
      "grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))]",
    );
    expect(group?.className).not.toContain("overflow-x-auto");
    expect(methods).toHaveLength(13);
    expect(methods[0]?.className).toContain("rounded-[var(--fm-radius-surface)]");
    expect(methods[0]?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelectorAll('[data-state="checked"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-state="unchecked"]')).toHaveLength(12);
    expect(container.textContent).not.toContain("E-wallet");
    expect(container.textContent).not.toContain("Direct debit");
    expect(container.textContent).not.toContain("Not active");
    expect(container.textContent).not.toContain("Available");
  });
});
