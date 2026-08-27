"use client";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { CartView, DeliveryCycleView } from "@freshmarkets/contracts";
import { StorefrontShell } from "../../components/storefront/storefront-shell";
import { OrderSummary } from "../../components/storefront/marketplace/order-summary";
import { fetchCart } from "../../lib/storefront/cart-client";
export default function CheckoutPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [cycles, setCycles] = useState<ReadonlyArray<DeliveryCycleView>>([]);
  const [addressId, setAddressId] = useState("");
  const [status, setStatus] = useState("");
  const [pendingQuote, setPendingQuote] = useState<{
    quoteId: string;
    totalMinor: number;
    currency: string;
  } | null>(null);
  const attemptKey = useRef(`checkout-${crypto.randomUUID()}`);
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
  }, []);
  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch("/api/commerce/address", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Home",
        recipient: data.recipient,
        phone: data.phone,
        address: { line1: data.address },
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      value?: { id: string; serviceable: boolean };
      error?: { message: string };
    };
    if (result.ok && result.value?.serviceable) {
      setAddressId(result.value.id);
      setStatus("Address confirmed for delivery.");
    } else setStatus(result.error?.message ?? "Address is outside the active delivery area.");
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
    // 1) Core-authoritative quote. Core recalculates before payment and any
    // changed total must be accepted through a new attempt.
    const quoteResponse = await fetch("/api/checkout/quote", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": attemptKey.current,
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
    if (!quoteResult.ok) {
      setPendingQuote(null);
      setStatus(quoteResult.error?.message ?? "Could not price your order.");
      return;
    }
    if (!quoteResult.value) return;
    setPendingQuote(quoteResult.value);
    setStatus(
      `Review your current total: ${quoteResult.value.currency} ${(quoteResult.value.totalMinor / 100).toFixed(2)}.`,
    );
  }

  async function confirmPayment() {
    if (!pendingQuote) return;
    // 2) Canonical payment intent. Order commitment happens in Core from the
    // provider-confirmed payment reaction — never from this browser.
    const paymentResponse = await fetch("/api/checkout/payment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": attemptKey.current,
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
              <form onSubmit={saveAddress} className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Recipient
                  <input
                    name="recipient"
                    placeholder="Full name"
                    required
                    className="min-h-12 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-3 font-normal outline-none focus:border-[var(--fm-primary-dark)]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Phone
                  <input
                    name="phone"
                    placeholder="09xx xxx xxxx"
                    required
                    className="min-h-12 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-3 font-normal outline-none focus:border-[var(--fm-primary-dark)]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold sm:col-span-2">
                  Cebu address
                  <input
                    name="address"
                    placeholder="House, street, barangay"
                    required
                    className="min-h-12 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-3 font-normal outline-none focus:border-[var(--fm-primary-dark)]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Latitude
                  <input
                    name="latitude"
                    defaultValue="10.3157"
                    required
                    className="min-h-12 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-3 font-normal outline-none focus:border-[var(--fm-primary-dark)]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Longitude
                  <input
                    name="longitude"
                    defaultValue="123.8854"
                    required
                    className="min-h-12 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-3 font-normal outline-none focus:border-[var(--fm-primary-dark)]"
                  />
                </label>
                <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white hover:bg-[#294f30] sm:col-span-2">
                  <MapPin className="size-4" aria-hidden="true" />
                  Confirm address
                </button>
              </form>
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
