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

    await act(async () => qrPh?.click());
    expect(onSelect).toHaveBeenCalledWith({ kind: "TOKEN", value: "qrph" });
  });
});
