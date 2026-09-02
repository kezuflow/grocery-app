"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  CartView,
  CheckoutQuoteView,
  CustomerAddressView,
  FulfillmentOptionView,
  PaymentActionView,
  RpcResult,
} from "@freshmarkets/contracts";
import { StorefrontShell } from "../../components/storefront/storefront-shell";
import { OrderSummary } from "../../components/storefront/marketplace/order-summary";
import { AddressEditor } from "../../components/storefront/address/address-editor";
import { AddressList } from "../../components/storefront/address/address-list";
import { PromotionEntry } from "../../components/storefront/checkout/promotion-entry";
import { CheckoutTotalReview } from "../../components/storefront/checkout/checkout-total-review";
import { FulfillmentOptionPicker } from "../../components/storefront/checkout/fulfillment-option-picker";
import { fetchCart } from "../../lib/storefront/cart-client";
export function CheckoutClient({ publicAccessToken }: { publicAccessToken?: string }) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [fulfillmentOptions, setFulfillmentOptions] = useState<readonly FulfillmentOptionView[]>(
    [],
  );
  const [addresses, setAddresses] = useState<ReadonlyArray<CustomerAddressView>>([]);
  const [addressLoadState, setAddressLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [editingAddress, setEditingAddress] = useState<CustomerAddressView>();
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  const [addressId, setAddressId] = useState("");
  const selectedAddressId = useRef("");
  const selectedFulfillmentOptionId = useRef("");
  const [status, setStatus] = useState("");
  const [promotionCodes, setPromotionCodes] = useState<readonly string[]>([]);
  const promotionCodesRef = useRef<readonly string[]>([]);
  const [acceptingPayment, setAcceptingPayment] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<
    | (CheckoutQuoteView & {
        input: {
          addressId: string;
          fulfillmentOptionId: string;
          cartVersion: number;
          promotionCodes: readonly string[];
        };
        attemptKey: string;
      })
    | null
  >(null);
  const attemptKey = useRef(`checkout-${crypto.randomUUID()}`);
  const addressLoadGeneration = useRef(0);
  useEffect(() => {
    void fetchCart().then((value) => {
      setCart(value ?? null);
      if (value?.id === "guest-cart") {
        setStatus("Your cart is saved. Sign in before checkout so we can confirm your delivery.");
      }
    });
    void loadAddresses();
    return () => {
      addressLoadGeneration.current += 1;
    };
  }, []);

  async function loadAddresses(preferredAddressId?: string) {
    const generation = ++addressLoadGeneration.current;
    setAddressLoadState("loading");
    try {
      const response = await fetch("/api/commerce/address", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = (await response.json()) as RpcResult<ReadonlyArray<CustomerAddressView>>;
      if (generation !== addressLoadGeneration.current) return;
      if (!response.ok || !result.ok) {
        setAddressLoadState("error");
        return;
      }
      setAddresses(result.value);
      setAddressLoadState("ready");
      const requestedAddressId = preferredAddressId ?? selectedAddressId.current;
      const confirmed = result.value.find((address) => address.id === requestedAddressId);
      setCurrentAddress(confirmed?.serviceable === true ? confirmed.id : "");
      invalidatePendingQuote();
      if (confirmed?.serviceable === true) void loadFulfillmentOptions(confirmed);
      if (preferredAddressId) {
        if (confirmed?.serviceable === true) {
          setStatus("Address confirmed for delivery.");
        } else {
          setStatus("This saved address is unavailable for checkout. Correct its pin to continue.");
        }
        setEditingAddress(undefined);
        setShowAddressEditor(false);
      }
    } catch {
      if (generation !== addressLoadGeneration.current) return;
      setAddressLoadState("error");
    }
  }

  function setCurrentAddress(nextAddressId: string) {
    selectedAddressId.current = nextAddressId;
    setAddressId(nextAddressId);
  }

  async function abandonQuote(quote: CheckoutQuoteView): Promise<boolean> {
    try {
      const response = await fetch(
        `/api/checkout/quote/${encodeURIComponent(quote.quoteId)}/abandon`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `checkout-abandon-${quote.quoteId}`,
          },
          body: JSON.stringify({ expectedVersion: quote.attemptVersion }),
        },
      );
      const result = (await response.json()) as RpcResult<unknown>;
      return result.ok;
    } catch {
      return false;
    }
  }

  function invalidatePendingQuote() {
    if (pendingQuote) void abandonQuote(pendingQuote);
    setPendingQuote(null);
    attemptKey.current = `checkout-${crypto.randomUUID()}`;
  }

  async function loadFulfillmentOptions(address: CustomerAddressView) {
    if (!cart || cart.id === "guest-cart" || !cart.items.length) {
      setFulfillmentOptions([]);
      return;
    }
    const response = await fetch("/api/checkout/fulfillment-options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        addressId: address.id,
        addressVersion: address.version,
        cartId: cart.id,
        cartVersion: cart.version,
      }),
    });
    const result = (await response.json()) as RpcResult<readonly FulfillmentOptionView[]>;
    if (result.ok) {
      setFulfillmentOptions(result.value);
      return;
    }
    setFulfillmentOptions([]);
    setStatus(result.error.message);
  }

  async function discardPendingQuote() {
    if (!pendingQuote) return;
    setStatus("Releasing the current checkout reservation…");
    if (!(await abandonQuote(pendingQuote))) {
      setStatus("The current checkout could not be released safely. Try again before restarting.");
      return;
    }
    setPendingQuote(null);
    attemptKey.current = `checkout-${crypto.randomUUID()}`;
    setStatus("Current checkout released. You can choose new delivery details.");
  }

  function quoteInputIsCurrent(input: {
    addressId: string;
    fulfillmentOptionId: string;
    cartVersion: number;
    promotionCodes: readonly string[];
  }) {
    return (
      input.addressId === selectedAddressId.current &&
      input.fulfillmentOptionId === selectedFulfillmentOptionId.current &&
      input.cartVersion === cart?.version &&
      input.promotionCodes.join("\u0000") === promotionCodesRef.current.join("\u0000")
    );
  }

  function selectAddress(nextAddressId: string) {
    const selected = addresses.find((address) => address.id === nextAddressId);
    if (selected?.serviceable !== true) {
      setCurrentAddress("");
      invalidatePendingQuote();
      setStatus("Only a serviceable saved address can be selected for checkout.");
      return;
    }
    const changed = selected.id !== selectedAddressId.current;
    if (changed) {
      setCurrentAddress(selected.id);
      invalidatePendingQuote();
      selectedFulfillmentOptionId.current = "";
      void loadFulfillmentOptions(selected);
    }
    if (!changed) void loadFulfillmentOptions(selected);
    setStatus("Serviceable delivery address selected. Core will recheck it before payment.");
  }
  async function reviewTotal(option: FulfillmentOptionView) {
    if (!cart || !addressId) {
      setStatus("Confirm a serviceable address first.");
      return;
    }
    if (cart.id === "guest-cart") {
      setStatus("Your cart is saved. Sign in before checkout so we can confirm your delivery.");
      return;
    }
    if (option.optionId !== selectedFulfillmentOptionId.current) {
      selectedFulfillmentOptionId.current = option.optionId;
      invalidatePendingQuote();
      setStatus("Checking the selected delivery window and current total.");
    }
    const quoteInput = {
      addressId: selectedAddressId.current,
      fulfillmentOptionId: option.optionId,
      cartVersion: cart.version,
      promotionCodes: promotionCodesRef.current,
    };
    const quoteAttemptKey = attemptKey.current;
    if (!quoteInputIsCurrent(quoteInput) || quoteAttemptKey !== attemptKey.current) return;
    // 1) Core-authoritative quote. Core recalculates before payment and any
    // changed total must be accepted through a new attempt.
    const quoteResponse = await fetch("/api/checkout/quote", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": quoteAttemptKey,
      },
      body: JSON.stringify({
        cartId: cart.id,
        cartVersion: cart.version,
        addressId,
        fulfillmentOptionId: option.optionId,
        promotionCodes: promotionCodesRef.current,
      }),
    });
    const quoteResult = (await quoteResponse.json()) as RpcResult<CheckoutQuoteView>;
    if (!quoteInputIsCurrent(quoteInput) || quoteAttemptKey !== attemptKey.current) return;
    if (!quoteResult.ok) {
      setPendingQuote(null);
      setStatus(quoteResult.error?.message ?? "Could not price your order.");
      return;
    }
    if (!quoteResult.value) return;
    setPendingQuote({ ...quoteResult.value, input: quoteInput, attemptKey: quoteAttemptKey });
    setStatus(
      `Review your current total: ${quoteResult.value.currency} ${(quoteResult.value.totalMinor / 100).toFixed(2)}.`,
    );
  }

  async function confirmPayment() {
    if (!pendingQuote) return;
    if (
      !quoteInputIsCurrent(pendingQuote.input) ||
      pendingQuote.attemptKey !== attemptKey.current
    ) {
      invalidatePendingQuote();
      setStatus("Delivery details changed. Review the current total again before payment.");
      return;
    }
    // 2) Canonical payment intent. Order commitment happens in Core from the
    // provider-confirmed payment reaction — never from this browser.
    setAcceptingPayment(true);
    const paymentResponse = await fetch("/api/checkout/payment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": pendingQuote.attemptKey,
      },
      body: JSON.stringify({
        checkoutAttemptId: pendingQuote.quoteId,
        expectedQuoteVersion: pendingQuote.attemptVersion,
        expectedPriceAcceptanceVersion: pendingQuote.priceAcceptanceVersion,
        expectedCurrency: pendingQuote.currency,
        expectedMerchandiseSubtotalMinor: pendingQuote.merchandiseSubtotalMinor,
        expectedItemDiscountMinor: pendingQuote.itemDiscountMinor,
        expectedOrderDiscountMinor: pendingQuote.orderDiscountMinor,
        expectedDeliverySubtotalMinor: pendingQuote.deliverySubtotalMinor,
        expectedDeliveryFeeMinor: pendingQuote.deliveryFeeMinor,
        expectedDeliveryDiscountMinor: pendingQuote.deliveryDiscountMinor,
        expectedServiceFeeMinor: pendingQuote.serviceFeeMinor,
        expectedTaxMinor: pendingQuote.taxMinor,
        expectedTotalMinor: pendingQuote.totalMinor,
        returnUrl: window.location.origin + "/orders",
      }),
    });
    const paymentResult = (await paymentResponse.json()) as RpcResult<PaymentActionView>;
    setAcceptingPayment(false);
    if (paymentResult.ok) {
      if (paymentResult.value.actionType === "REDIRECT" && paymentResult.value.redirectUrl) {
        setStatus("Payment is ready. Redirecting to the secure payment page…");
        window.location.assign(paymentResult.value.redirectUrl);
      } else if (paymentResult.value.actionType === "SDK" && paymentResult.value.clientToken) {
        sessionStorage.setItem(
          "freshmarkets.checkoutPaymentAction",
          JSON.stringify(paymentResult.value),
        );
        window.location.assign("/checkout/payment");
      } else {
        setStatus("Payment started. Keep this page open while the provider confirms it.");
      }
    } else {
      if (paymentResult.error?.code === "PRICE_CHANGED") {
        setPendingQuote(null);
        attemptKey.current = `checkout-${crypto.randomUUID()}`;
      }
      setStatus(paymentResult.error?.message ?? "Payments are unavailable right now.");
    }
  }
  const guest = cart?.id === "guest-cart";
  const canReview = Boolean(cart?.items.length && addressId && !guest);
  return (
    <StorefrontShell>
      <div className="min-h-[100dvh] w-full px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
        <Link
          href="/cart"
          className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--fm-primary-dark)] underline underline-offset-4"
        >
          Back to cart
        </Link>
        <div className="mt-7 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
              Secure checkout
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em]">Checkout</h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--fm-text-muted)]">
              Confirm your delivery details and current total before payment.
            </p>

            {guest ? (
              <div className="mt-6 rounded-[var(--fm-radius-surface)] border border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] p-5">
                <p className="font-semibold">Sign in to continue with this saved cart.</p>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Your items stay saved while you sign in. The current minimum order is checked by
                  Core.
                </p>
                <Link
                  href="/auth/login?returnTo=/checkout"
                  className="mt-4 inline-flex min-h-10 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white hover:bg-[#294f30]"
                >
                  Sign in to continue
                </Link>
              </div>
            ) : null}

            <section className="mt-6 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--fm-primary-dark)] text-sm font-bold text-white">
                  1
                </span>
                <div>
                  <h2 className="text-lg font-bold">Delivery details</h2>
                  <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                    We use this address to confirm Cebu coverage and delivery fees.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                {addressLoadState === "loading" ? (
                  <p role="status" className="text-sm text-[var(--fm-text-muted)]">
                    Loading saved delivery addresses…
                  </p>
                ) : addressLoadState === "error" ? (
                  <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
                    <p>Saved addresses could not be loaded. Sign in or try again.</p>
                    <button
                      type="button"
                      onClick={() => void loadAddresses()}
                      className="mt-3 rounded-lg border border-red-300 px-3 py-2 font-semibold"
                    >
                      Retry address load
                    </button>
                  </div>
                ) : (
                  <AddressList
                    addresses={addresses}
                    selectedAddressId={addressId}
                    onSelect={selectAddress}
                    onCorrect={(address) => {
                      setEditingAddress(address);
                      setShowAddressEditor(true);
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingAddress(undefined);
                    setShowAddressEditor((current) => !current);
                  }}
                  className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
                >
                  {showAddressEditor && !editingAddress ? "Close address editor" : "Add address"}
                </button>
                {showAddressEditor ? (
                  <div className="mt-6 border-t border-[var(--fm-border)] pt-6">
                    <AddressEditor
                      key={editingAddress?.id ?? "checkout-new-address"}
                      publicAccessToken={publicAccessToken}
                      initialAddress={editingAddress}
                      onConfirmed={(confirmedAddressId) => {
                        invalidatePendingQuote();
                        void loadAddresses(confirmedAddressId);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </section>

            <PromotionEntry
              codes={promotionCodes}
              feedback={pendingQuote?.promotionFeedback ?? []}
              disabled={guest || acceptingPayment}
              onAdd={(code) => {
                const next = [...promotionCodesRef.current, code];
                promotionCodesRef.current = next;
                setPromotionCodes(next);
                invalidatePendingQuote();
                setStatus(`${code} added. Review the total again to check the promotion.`);
              }}
              onRemove={(code) => {
                const next = promotionCodesRef.current.filter(
                  (currentCode) => currentCode !== code,
                );
                promotionCodesRef.current = next;
                setPromotionCodes(next);
                invalidatePendingQuote();
                setStatus(`${code} removed. Review the total again.`);
              }}
            />

            <section className="mt-5 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--fm-primary-dark)] text-sm font-bold text-white">
                  2
                </span>
                <div>
                  <h2 className="text-lg font-bold">Delivery option</h2>
                  <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                    Choose Instant or Scheduled when available. Core rechecks the promise, fee,
                    inventory, cutoff, and capacity before payment.
                  </p>
                </div>
              </div>
              <div>
                {fulfillmentOptions.length ? (
                  <FulfillmentOptionPicker
                    options={fulfillmentOptions}
                    disabled={!canReview}
                    onSelect={(option) => void reviewTotal(option)}
                  />
                ) : (
                  <p className="rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] p-4 text-sm text-[var(--fm-text-muted)]">
                    Select a confirmed address to load delivery options.
                  </p>
                )}
              </div>
            </section>

            {pendingQuote ? (
              <div>
                <CheckoutTotalReview
                  quote={pendingQuote}
                  onAccept={confirmPayment}
                  accepting={acceptingPayment}
                />
                <button
                  type="button"
                  onClick={() => void discardPendingQuote()}
                  disabled={acceptingPayment}
                  className="mt-3 text-sm font-semibold underline underline-offset-4 disabled:opacity-50"
                >
                  Discard current total and start again
                </button>
              </div>
            ) : null}
            {status ? (
              <p
                role="status"
                className="mt-5 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white p-4 text-sm"
              >
                {status}
              </p>
            ) : null}
          </div>

          <div className="xl:sticky xl:top-24">
            <OrderSummary
              cart={cart}
              totalMinor={pendingQuote?.totalMinor}
              quote={pendingQuote ?? undefined}
              actionLabel={
                guest
                  ? "Sign in to continue"
                  : pendingQuote
                    ? "Accept total and continue"
                    : "Review total after address"
              }
              actionHref={guest ? "/auth/login?returnTo=/checkout" : undefined}
              onAction={pendingQuote ? confirmPayment : undefined}
              disabled={guest ? false : !pendingQuote}
              note="Minimum order, availability, serviceability, and delivery fees are confirmed by Core."
            />
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
