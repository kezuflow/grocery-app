import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkout = readFileSync(new URL("./checkout-client.tsx", import.meta.url), "utf8");

describe("checkout address guide layout contract", () => {
  it("uses the simplified address guide inside the complete checkout workspace", () => {
    expect(checkout).toContain("<AddressEditor");
    expect(checkout).toContain("multiStep");
    expect(checkout).toContain("Review your current destination or choose another saved address.");
    expect(checkout).not.toContain("Choose a saved address or add a destination to continue.");
    expect(checkout).toContain("Complete delivery details");
    expect(checkout).toContain('aria-label="Address setup workspace"');
    expect(checkout).toContain("Your cart and order total remain available beside this guide.");
    expect(checkout).toContain("Saved addresses");
    expect(checkout).toContain("Choose delivery");
    expect(checkout).not.toContain("Choose when it arrives");
    expect(checkout).toContain("Available Instant and Scheduled options");
    expect(checkout).not.toContain(
      'className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] pb-5"',
    );
    expect(checkout).not.toContain(
      'className="flex items-start gap-3 border-b border-[var(--fm-border)] pb-5"',
    );
    expect(checkout).not.toContain(
      "Checking {deliveryPartnerName(selectedFulfillmentOption)} route",
    );
    expect(checkout).not.toContain("route availability and delivery fee");
    expect(checkout).toContain("loadingOptionId={");
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
    expect(checkout).not.toContain("<CheckoutTotalReview");
    expect(checkout).not.toContain("Discard current total and start again");
    expect(checkout).toContain('"Choose a payment method"');
    expect(checkout).toContain('"Continue with QR Ph"');
    expect(checkout).toContain("!selectedPaymentMethod");
    expect(checkout).toContain("automaticQuoteFingerprint");
    expect(checkout).toContain("quoteInputFingerprint");
    expect(checkout).toContain("settlePreviousQuoteWork");
    expect(checkout).toContain("cart?.paymentInProgress");
    expect(checkout).toContain("window.location.replace(paymentContinuationHref");
    expect(checkout).toContain("CHECKOUT_PAYMENT_IN_PROGRESS_REASON");
    expect(checkout).toContain("window.sessionStorage.setItem");
  });

  it("keeps the checkout workspace flat while saved addresses use one boxed row", () => {
    expect(checkout).toContain("bg-[var(--fm-background)]");
    expect(checkout).toContain('variant="row"');
    expect(checkout).toContain('surface="flat"');
    expect(checkout).toContain('<section className="min-w-0 py-7">');
    expect(checkout).toContain('className="mt-5 flex items-start gap-2 text-sm"');
    expect(checkout).toContain('className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0"');
    expect(checkout).not.toContain("Other saved addresses");
    expect(checkout).toContain("Scheduled delivery cutoff: Friday, 11:59 PM.");
  });
});
