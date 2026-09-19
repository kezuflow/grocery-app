import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkout = readFileSync(new URL("./checkout-client.tsx", import.meta.url), "utf8");

describe("checkout address guide layout contract", () => {
  it("uses the simplified address guide inside the complete checkout workspace", () => {
    expect(checkout).toContain("<AddressEditor");
    expect(checkout).toContain("multiStep");
    expect(checkout).toContain("Review your current destination or choose another saved address.");
    expect(checkout).toContain("Complete delivery details");
    expect(checkout).toContain('aria-label="Address setup workspace"');
    expect(checkout).toContain("Your cart and order total remain available beside this guide.");
    expect(checkout).toContain("Other saved addresses");
    expect(checkout).toContain("Choose a courier");
    expect(checkout).not.toContain("Choose when it arrives");
    expect(checkout).toContain('option.mode === "INSTANT"');
    expect(checkout).not.toContain("type CheckoutStep");
    expect(checkout).not.toContain('aria-label="Checkout progress"');
    expect(checkout).not.toContain("<PromotionEntry");
    expect(checkout).toContain("checkoutDraft.draft.promotionCodes");
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
    expect(checkout).toContain("onQuantityChange={");
    expect(checkout).toContain("updatingSkuId={updatingSkuId}");
    expect(checkout).toContain("showAction={false}");
    expect(checkout).toContain("cart?.paymentInProgress");
    expect(checkout).toContain("window.location.replace(paymentContinuationHref");
    expect(checkout).toContain("CHECKOUT_PAYMENT_IN_PROGRESS_REASON");
    expect(checkout).toContain("window.sessionStorage.setItem");
  });

  it("uses flat surfaces across the checkout review workspace", () => {
    expect(checkout).toContain("bg-[var(--fm-background)]");
    expect(checkout).toContain('variant="flat"');
    expect(checkout).toContain('surface="flat"');
    expect(checkout).toContain('className="grid gap-0"');
  });
});
