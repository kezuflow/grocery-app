"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { CartView, DeliveryCycleView } from "@freshmarkets/contracts";
export default function CheckoutPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [cycles, setCycles] = useState<ReadonlyArray<DeliveryCycleView>>([]);
  const [addressId, setAddressId] = useState("");
  const [status, setStatus] = useState("");
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
  async function commit(cycleId: string) {
    if (!cart || !addressId) {
      setStatus("Confirm a serviceable address first.");
      return;
    }
    const response = await fetch("/api/commerce/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cartId: cart.id,
        addressId,
        cycleId,
        commit: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      value?: { orderId: string };
      error?: { message: string };
    };
    setStatus(
      result.ok
        ? `Order ${result.value?.orderId} is paid and committed.`
        : (result.error?.message ?? "Checkout failed."),
    );
  }
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/cart" className="text-sm underline">
        Back to cart
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">Checkout</h1>
      <p className="mt-2 text-sm text-slate-600">
        Sandbox payment is used locally. Payment success locks the order.
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
              onClick={() => commit(cycle.id)}
              className="flex items-center justify-between rounded-lg border bg-white p-4 text-left"
            >
              <span>
                {cycle.name}
                <small className="block text-slate-600">
                  {new Date(cycle.deliveryDate).toLocaleString()}
                </small>
              </span>
              <span className="font-medium">Pay and commit</span>
            </button>
          ))}
        </div>
      </section>
      {status ? (
        <p role="status" className="mt-6 rounded border bg-white p-4">
          {status}
        </p>
      ) : null}
    </main>
  );
}
