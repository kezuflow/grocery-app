"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type StoredAction = {
  providerCode?: string;
  providerReference?: string;
  actionType: "SDK";
  clientToken: string;
  expiresAt: string;
};
type PayMongoResource = {
  data?: { id?: string; attributes?: { next_action?: { redirect?: { url?: string } } } };
  errors?: Array<{ detail?: string }>;
};
const basic = (key: string) => `Basic ${btoa(`${key}:`)}`;

export function PayMongoCardPayment({
  storageKey,
  title,
  description,
  returnPath,
  donePath,
  backPath,
}: {
  storageKey: string;
  title: string;
  description: string;
  returnPath: string;
  donePath: string;
  backPath: string;
}) {
  const [action, setAction] = useState<(StoredAction & { providerReference: string }) | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading secure payment setup…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) {
      setMessage("This payment setup is missing or has already been used.");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as StoredAction;
      const providerReference =
        parsed.providerReference ?? parsed.clientToken?.split("_client_")[0] ?? "";
      if (
        (parsed.providerCode && parsed.providerCode !== "paymongo") ||
        parsed.actionType !== "SDK" ||
        !providerReference ||
        !parsed.clientToken ||
        Date.parse(parsed.expiresAt) <= Date.now()
      )
        throw new Error("expired");
      setAction({ ...parsed, providerReference });
    } catch {
      sessionStorage.removeItem(storageKey);
      setMessage("This payment setup has expired. Return and start again.");
      return;
    }
    void fetch("/api/checkout/payment")
      .then(
        (response) =>
          response.json() as Promise<{
            ok: boolean;
            value?: { publicKey?: string | null };
          }>,
      )
      .then((result) => {
        if (!result.ok || !result.value?.publicKey) throw new Error("PayMongo is unavailable");
        setPublicKey(result.value.publicKey);
        setMessage("");
      })
      .catch((error) => setMessage((error as Error).message));
  }, [storageKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !publicKey) return;
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      // Card data goes directly to PayMongo and never crosses a FreshMarkets
      // server boundary, keeping it out of application storage and logs.
      const methodResponse = await fetch("https://api.paymongo.com/v1/payment_methods", {
        method: "POST",
        headers: { authorization: basic(publicKey), "content-type": "application/json" },
        body: JSON.stringify({
          data: {
            attributes: {
              type: "card",
              details: {
                card_number: String(form.get("cardNumber") ?? "").replaceAll(" ", ""),
                exp_month: Number(form.get("expMonth")),
                exp_year: Number(form.get("expYear")),
                cvc: String(form.get("cvc") ?? ""),
              },
              billing: {
                name: String(form.get("name") ?? ""),
                email: String(form.get("email") ?? ""),
                phone: String(form.get("phone") ?? ""),
              },
            },
          },
        }),
      });
      const method = (await methodResponse.json()) as PayMongoResource;
      if (!methodResponse.ok || !method.data?.id)
        throw new Error(method.errors?.[0]?.detail ?? "PayMongo could not tokenize this card.");
      const attachResponse = await fetch(
        `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(action.providerReference)}/attach`,
        {
          method: "POST",
          headers: { authorization: basic(publicKey), "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              attributes: {
                payment_method: method.data.id,
                client_key: action.clientToken,
                return_url: `${window.location.origin}${returnPath}`,
              },
            },
          }),
        },
      );
      const intent = (await attachResponse.json()) as PayMongoResource;
      if (!attachResponse.ok)
        throw new Error(intent.errors?.[0]?.detail ?? "PayMongo could not start this payment.");
      const redirect = intent.data?.attributes?.next_action?.redirect?.url;
      sessionStorage.removeItem(storageKey);
      window.location.assign(redirect || donePath);
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </div>
      {action && publicKey ? (
        <form onSubmit={submit} className="grid gap-4 rounded-lg border bg-white p-6">
          <label className="grid gap-1 text-sm">
            <span>Name on card</span>
            <input
              name="name"
              required
              autoComplete="cc-name"
              className="rounded border px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Email</span>
            <input
              name="email"
              required
              type="email"
              autoComplete="email"
              className="rounded border px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Phone</span>
            <input name="phone" required autoComplete="tel" className="rounded border px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Card number</span>
            <input
              name="cardNumber"
              required
              inputMode="numeric"
              autoComplete="cc-number"
              className="rounded border px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="grid gap-1 text-sm">
              <span>Month</span>
              <input
                name="expMonth"
                required
                inputMode="numeric"
                autoComplete="cc-exp-month"
                className="rounded border px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Year</span>
              <input
                name="expYear"
                required
                inputMode="numeric"
                autoComplete="cc-exp-year"
                className="rounded border px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>CVC</span>
              <input
                name="cvc"
                required
                inputMode="numeric"
                autoComplete="cc-csc"
                className="rounded border px-3 py-2"
              />
            </label>
          </div>
          <button
            disabled={busy}
            className="rounded bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Connecting to PayMongo…" : "Continue securely"}
          </button>
        </form>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <Link href={backPath} className="text-sm underline">
        Back
      </Link>
    </main>
  );
}
