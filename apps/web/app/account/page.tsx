"use client";
import Link from "next/link";
import { useRef, useState } from "react";
export default function AccountPage() {
  const [message, setMessage] = useState("");
  // One stable key per logical start-trial action, reused across retries.
  const attemptKey = useRef(`trial-${crypto.randomUUID()}`);
  async function trial() {
    const response = await fetch("/api/commerce/trial", {
      method: "POST",
      headers: { "idempotency-key": attemptKey.current },
    });
    const result = (await response.json()) as {
      ok?: boolean;
      value?: { state: string | null; trialEndsAt: string | null };
      error?: { message: string };
    };
    if (result.ok) {
      setMessage(
        `Membership: ${result.value?.state ?? "none"}. Trial ends ${result.value?.trialEndsAt ?? "-"}.`,
      );
      attemptKey.current = `trial-${crypto.randomUUID()}`;
    } else {
      setMessage(result.error?.message ?? "Unable to start trial.");
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <Link href="/" className="text-sm underline">
        Back to marketplace
      </Link>
      <h1 className="text-3xl font-semibold">Your account</h1>
      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold">FreshMarkets membership</h2>
        <p className="mt-2 text-sm text-slate-600">
          A trial or active subscription is required before checkout.
        </p>
        <button
          onClick={trial}
          className="mt-4 rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white"
        >
          Start trial
        </button>
        {message ? (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        ) : null}
      </section>
      <Link href="/cart" className="font-medium underline">
        Open cart
      </Link>
      <Link href="/orders" className="font-medium underline">
        Order history
      </Link>
    </main>
  );
}
