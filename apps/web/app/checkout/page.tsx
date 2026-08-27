"use client";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { CartView, DeliveryCycleView } from "@freshmarkets/contracts";
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
      fetch("/api/commerce/cart").then((r) => r.json() as Promise<{ value?: CartView }>),
      fetch("/api/commerce/cycles").then(
        (r) => r.json() as Promise<{ value?: ReadonlyArray<DeliveryCycleView> }>,
      ),
    ]).then(([cartResult, cycleResult]) => {
      setCart(cartResult.value ?? null);
      setCycles(cycleResult.value ?? []);
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
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/cart" className="text-sm underline">
        Back to cart
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">Checkout</h1>
      <p className="mt-2 text-sm text-slate-600">
        Price, stock, serviceability, and delivery fees are confirmed before payment.
      </p>
      <form
        onSubmit={saveAddress}
        className="mt-6 grid gap-4 rounded-lg border bg-white p-6 sm:grid-cols-2"
      >
        <input name="recipient" placeholder="Recipient" required className="rounded border p-3" />
        <input name="phone" placeholder="Phone" required className="rounded border p-3" />
        <input
          name="address"
          placeholder="Cebu address"
          required
          className="rounded border p-3 sm:col-span-2"
        />
        <input name="latitude" defaultValue="10.3157" required className="rounded border p-3" />
        <input name="longitude" defaultValue="123.8854" required className="rounded border p-3" />
        <button className="rounded bg-slate-950 px-4 py-2 text-white sm:col-span-2">
          Confirm address
        </button>
      </form>
      <section className="mt-6">
        <h2 className="font-semibold">Delivery cycle</h2>
        <div className="mt-3 grid gap-3">
          {cycles.map((cycle) => (
            <button
              key={cycle.id}
              onClick={() => reviewTotal(cycle.id)}
              className="flex items-center justify-between rounded-lg border bg-white p-4 text-left"
            >
              <span>
                {cycle.name}
                <small className="block text-slate-600">
                  {new Date(cycle.deliveryDate).toLocaleString()}
                </small>
              </span>
              <span className="font-medium">Review total</span>
            </button>
          ))}
        </div>
      </section>
      {pendingQuote ? (
        <section className="mt-6 rounded-lg border bg-white p-6" aria-label="Order total review">
          <p className="text-sm text-slate-600">Current authoritative total</p>
          <p className="mt-1 text-2xl font-semibold">
            {pendingQuote.currency} {(pendingQuote.totalMinor / 100).toFixed(2)}
          </p>
          <button
            type="button"
            onClick={confirmPayment}
            className="mt-4 rounded bg-slate-950 px-4 py-2 text-white"
          >
            Accept total and continue to payment
          </button>
        </section>
      ) : null}
      {status ? (
        <p role="status" className="mt-6 rounded border bg-white p-4">
          {status}
        </p>
      ) : null}
    </main>
  );
}
