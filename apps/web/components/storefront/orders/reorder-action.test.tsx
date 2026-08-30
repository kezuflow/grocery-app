import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReorderResultView } from "@freshmarkets/contracts";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
import { ReorderAction, reorderResultMessage } from "./reorder-action";

describe("ReorderAction", () => {
  it("renders a keyboard action and polite mutation status region", () => {
    const html = renderToStaticMarkup(<ReorderAction orderId="order-1" available />);
    expect(html).toContain("Buy again");
    expect(html).toContain('aria-live="polite"');
  });

  it("describes partial current-state results without claiming an identical order", () => {
    const result = {
      outcome: "PARTIAL",
      cartId: "cart-1",
      newCartVersion: 2,
      addedLines: [
        {
          skuId: "sku-1",
          name: "Onion",
          quantityAdded: 2,
          newQuantity: 2,
          currentUnitPriceMinor: 100,
          currency: "PHP",
        },
      ],
      skippedLines: [
        { skuId: "sku-2", productName: "Old item", quantity: 1, reason: "SKU_INACTIVE" },
      ],
      requiresFulfillmentReview: true,
      requiresAddressReview: true,
    } satisfies ReorderResultView;
    const message = reorderResultMessage(result);
    expect(message).toContain("2 items added at current prices");
    expect(message).toContain("1 line was skipped");
    expect(message).not.toMatch(/same order|identical/i);
  });
});
