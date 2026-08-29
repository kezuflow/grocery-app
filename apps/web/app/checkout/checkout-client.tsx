"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  CartView,
  CustomerAddressView,
  DeliveryCycleView,
  RpcResult,
} from "@freshmarkets/contracts";
import { StorefrontShell } from "../../components/storefront/storefront-shell";
import { OrderSummary } from "../../components/storefront/marketplace/order-summary";
import { AddressEditor } from "../../components/storefront/address/address-editor";
import { AddressList } from "../../components/storefront/address/address-list";
import { fetchCart } from "../../lib/storefront/cart-client";
export function CheckoutClient({ publicAccessToken }: { publicAccessToken?: string }) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [cycles, setCycles] = useState<ReadonlyArray<DeliveryCycleView>>([]);
  const [addresses, setAddresses] = useState<ReadonlyArray<CustomerAddressView>>([]);
  const [addressLoadState, setAddressLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [editingAddress, setEditingAddress] = useState<CustomerAddressView>();
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  const [addressId, setAddressId] = useState("");
  const selectedAddressId = useRef("");
  const selectedCycleId = useRef("");
  const [status, setStatus] = useState("");
  const [pendingQuote, setPendingQuote] = useState<{
    quoteId: string;
    totalMinor: number;
    currency: string;
    input: { addressId: string; cycleId: string; cartVersion: number };
    attemptKey: string;
  } | null>(null);
  const attemptKey = useRef(`checkout-${crypto.randomUUID()}`);
  const addressLoadGeneration = useRef(0);
  useEffect(() => {
    void Promise.all([
      fetchCart().then((value) => ({ value })),
      fetch("/api/commerce/cycles").then(
        (r) => r.json() as Promise<{ value?: ReadonlyArray<DeliveryCycleView> }>,
      ),
    ]).then(([cartResult, cycleResult]) => {
      setCart(cartResult.value ?? null);
      setCycles(cycleResult.value ?? []);
      if (cartResult.value?.id === "guest-cart") {
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

  function invalidatePendingQuote() {
    setPendingQuote(null);
    attemptKey.current = `checkout-${crypto.randomUUID()}`;
  }

  function quoteInputIsCurrent(input: { addressId: string; cycleId: string; cartVersion: number }) {
    return (
      input.addressId === selectedAddressId.current &&
      input.cycleId === selectedCycleId.current &&
      input.cartVersion === cart?.version
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
    if (selected.id !== selectedAddressId.current) {
      setCurrentAddress(selected.id);
      invalidatePendingQuote();
    }
    setStatus("Serviceable delivery address selected. Core will recheck it before payment.");
  }
  async function reviewTotal(cycleId: string) {
    if (!cart || !addressId) {
      setStatus("Confirm a serviceable address first.");
      return;
    }
    if (cart.id === "guest-cart") {
      setStatus("Your cart is saved. Sign in before checkout so we can confirm your delivery.");
      return;
    }
    if (cycleId !== selectedCycleId.current) {
      selectedCycleId.current = cycleId;
      invalidatePendingQuote();
      setStatus("Checking the selected delivery window and current total.");
    }
    const quoteInput = { addressId: selectedAddressId.current, cycleId, cartVersion: cart.version };
    const quoteAttemptKey = attemptKey.current;
    const eligibilityResponse = await fetch("/api/commerce/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cartId: cart.id, addressId, cycleId }),
    });
    const eligibilityResult = (await eligibilityResponse.json()) as {
      ok: boolean;
      value?: { eligible: boolean; failures: ReadonlyArray<string> };
      error?: { message?: string };
    };
    if (!eligibilityResult.ok || !eligibilityResult.value?.eligible) {
      const failures = eligibilityResult.value?.failures ?? [];
      setStatus(
        failures.includes("MINIMUM_ORDER_NOT_MET")
          ? "Your basket is below the current minimum configured for this delivery cycle. Add more items to continue."
          : (eligibilityResult.error?.message ?? "Checkout requirements are not met yet."),
      );
      return;
    }
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
        cycleId,
      }),
    });
    const quoteResult = (await quoteResponse.json()) as {
      ok: boolean;
      value?: { quoteId: string; totalMinor: number; currency: string };
      error?: { code: string; message: string };
    };
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
    const paymentResponse = await fetch("/api/checkout/payment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": pendingQuote.attemptKey,
      },
      body: JSON.stringify({
        checkoutAttemptId: pendingQuote.quoteId,
        expectedTotalMinor: pendingQuote.totalMinor,
        returnUrl: window.location.origin + "/orders",
      }),
    });
    const paymentResult = (await paymentResponse.json()) as {
      ok: boolean;
      error?: { code: string; message: string };
    };
    if (paymentResult.ok) {
      setStatus("Payment started. Your order appears here once payment is confirmed.");
      setPendingQuote(null);
      attemptKey.current = `checkout-${crypto.randomUUID()}`;
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

            <section className="mt-5 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--fm-primary-dark)] text-sm font-bold text-white">
                  2
                </span>
                <div>
                  <h2 className="text-lg font-bold">Delivery cycle</h2>
                  <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                    Choose an open delivery window. Core rechecks cutoff and capacity before
                    payment.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3">
                {cycles.length ? (
                  cycles.map((cycle) => (
                    <button
                      key={cycle.id}
                      type="button"
                      onClick={() => reviewTotal(cycle.id)}
                      disabled={!canReview}
                      className="flex min-h-16 items-center justify-between gap-4 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] p-4 text-left transition-colors hover:border-[var(--fm-primary-dark)] hover:bg-[var(--fm-surface-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>
                        <span className="block font-semibold">{cycle.name}</span>
                        <small className="mt-1 block text-xs text-[var(--fm-text-muted)]">
                          {new Date(cycle.deliveryDate).toLocaleString()}
                        </small>
                      </span>
                      <span className="text-sm font-bold text-[var(--fm-primary-dark)]">
                        Review total
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] p-4 text-sm text-[var(--fm-text-muted)]">
                    Delivery windows are not available right now.
                  </p>
                )}
              </div>
            </section>

            {pendingQuote ? (
              <section
                className="mt-5 rounded-[var(--fm-radius-surface)] border border-[var(--fm-success-border)] bg-[var(--fm-success-soft)] p-5 sm:p-6"
                aria-label="Order total review"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--fm-success)] text-sm font-bold text-white">
                    3
                  </span>
                  <div>
                    <h2 className="text-lg font-bold">Payment review</h2>
                    <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                      Core returned the current authoritative total. Accept it to start payment.
                    </p>
                  </div>
                </div>
                <p className="mt-5 text-2xl font-bold tabular-nums">
                  {pendingQuote.currency} {(pendingQuote.totalMinor / 100).toFixed(2)}
                </p>
                <button
                  type="button"
                  onClick={confirmPayment}
                  className="mt-4 inline-flex min-h-12 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-5 text-sm font-bold text-[var(--fm-primary-dark)] hover:bg-[#c4fa69]"
                >
                  Accept total and continue to payment
                </button>
              </section>
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
