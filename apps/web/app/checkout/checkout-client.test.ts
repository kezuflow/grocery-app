import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkout = readFileSync(new URL("./checkout-client.tsx", import.meta.url), "utf8");

describe("checkout address guide layout contract", () => {
  it("uses the address editor's three-step guide inside the complete checkout workspace", () => {
    expect(checkout).toContain("<AddressEditor");
    expect(checkout).toContain("multiStep");
    expect(checkout).toContain("complete the three-step address guide");
    expect(checkout).toContain('aria-label="Address setup workspace"');
    expect(checkout).toContain("Your cart and order total remain available beside this guide.");
    expect(checkout).toContain("Where should we deliver?");
    expect(checkout).toContain("Choose when it arrives");
    expect(checkout).not.toContain("type CheckoutStep");
    expect(checkout).not.toContain('aria-label="Checkout progress"');
    expect(checkout).toContain("<PromotionEntry");
    expect(checkout).toContain("<FulfillmentOptionPicker");
  });

  it("uses the rich editable order summary and invalidates pricing before quantity changes", () => {
    const quantityUpdate = checkout.slice(
      checkout.indexOf("async function updateCartQuantity"),
      checkout.indexOf("async function confirmPayment"),
    );
    expect(quantityUpdate.indexOf("await invalidatePendingQuote()")).toBeLessThan(
      quantityUpdate.indexOf("await addToCart(item.skuId, quantity"),
    );
    expect(checkout).toContain("showItems");
    expect(checkout).toContain("onQuantityChange={(item, quantity)");
    expect(checkout).toContain("updatingSkuId={updatingSkuId}");
    expect(checkout).toContain("showAction={false}");
  });
});
