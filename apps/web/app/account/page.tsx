"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const PENDING_AUTHORIZATION_KEY = "freshmarkets.pendingAuthorization";

type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

export default function AccountPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // One stable key per logical begin-enrollment action, reused across retries.
  const attemptKey = useRef(`authorization-${crypto.randomUUID()}`);

  // After returning from the provider's instrument collection, confirm the
  // authorization and only then start the trial it gates.
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_AUTHORIZATION_KEY);
    if (!pending) return;
    sessionStorage.removeItem(PENDING_AUTHORIZATION_KEY);
    setBusy(true);
    (async () => {
      const completed = (await fetch("/api/membership/authorization/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorizationId: pending }),
      }).then((response) => response.json())) as RpcResult<{ authorizationId: string }>;
      if (!completed.ok) {
        setMessage(completed.error.message);
        return;
      }
      const trial = (await fetch("/api/commerce/trial", {
        method: "POST",
        headers: { "idempotency-key": `trial-${crypto.randomUUID()}` },
      }).then((response) => response.json())) as RpcResult<{
        state: string | null;
        trialEndsAt: string | null;
      }>;
      setMessage(
        trial.ok
          ? `Membership: ${trial.value.state ?? "none"}. Trial ends ${trial.value.trialEndsAt ?? "-"}.`
          : trial.error.message,
      );
    })().finally(() => setBusy(false));
  }, []);

  async function enroll() {
    setBusy(true);
    try {
      const begun = (await fetch("/api/membership/authorization", {
        method: "POST",
        headers: { "idempotency-key": attemptKey.current },
      }).then((response) => response.json())) as RpcResult<{
        authorizationId: string;
        actionType: "REDIRECT" | "SDK" | "NONE";
        redirectUrl: string | null;
      }>;
      if (!begun.ok) {
        setMessage(begun.error.message);
        return;
      }
      if (begun.value.actionType === "REDIRECT" && begun.value.redirectUrl) {
        sessionStorage.setItem(PENDING_AUTHORIZATION_KEY, begun.value.authorizationId);
        window.location.assign(begun.value.redirectUrl);
        return;
      }
      setMessage("The payment provider did not return an authorization step. Try again shortly.");
    } finally {
      setBusy(false);
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
          A membership is required before checkout. The introductory trial is one calendar month and
          starts after you authorize a recurring-capable payment instrument; the first paid charge
          happens when the trial ends.
        </p>
        <button
          onClick={enroll}
          disabled={busy}
          className="mt-4 rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Authorize and start trial"}
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
