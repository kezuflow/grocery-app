"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { CheckoutPaymentCompletionView, PaymentMethodToken } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { PaymentSuccessAnimation } from "./payment-success-animation";

const QR_PH_EXPIRY_SECONDS = 30 * 60;
const COMPLETION_POLL_LIMIT_MS = 20 * 60 * 1000;

const completionResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      paymentIntentId: z.string(),
      state: z.enum(["WAITING_FOR_PAYMENT", "FINALIZING_ORDER", "COMPLETED", "FAILED", "EXPIRED"]),
      orderId: z.string().nullable(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);

type StoredAction = {
  paymentIntentId?: string;
  providerCode?: string;
  providerReference?: string;
  paymentMethod?: PaymentMethodToken | null;
  actionType: "SDK";
  clientToken: string;
  expiresAt: string;
  qrCode?: string;
  qrCodeExpiresAt?: string;
};
type PayMongoResource = {
  data?: {
    id?: string;
    attributes?: {
      next_action?: {
        redirect?: { url?: string };
        code?: { image_url?: string };
      };
    };
  };
  errors?: Array<{ detail?: string }>;
};
const basic = (key: string) => `Basic ${btoa(`${key}:`)}`;
const countdown = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

export function PayMongoPayment({
  storageKey,
  title,
  description,
  returnPath,
  donePath,
  backPath,
  completionStatusPath,
}: {
  storageKey: string;
  title: string;
  description: string;
  returnPath: string;
  donePath: string;
  backPath: string;
  completionStatusPath?: string;
}) {
  const [action, setAction] = useState<(StoredAction & { providerReference: string }) | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading secure payment setup…");
  const [busy, setBusy] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrCodeExpiresAt, setQrCodeExpiresAt] = useState<number | null>(null);
  const [qrRemainingSeconds, setQrRemainingSeconds] = useState<number | null>(null);
  const [completion, setCompletion] = useState<CheckoutPaymentCompletionView | null>(null);
  const [completionChecked, setCompletionChecked] = useState(!completionStatusPath);
  const [pollingStopped, setPollingStopped] = useState(false);
  const qrGenerationInFlight = useRef(false);
  const qrAutoGenerationStarted = useRef(false);
  const paymentIntentId = action?.paymentIntentId;
  const hasAction = action !== null;

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
      const savedQrExpiry = parsed.qrCodeExpiresAt
        ? Date.parse(parsed.qrCodeExpiresAt)
        : Number.NaN;
      if (parsed.qrCode && Number.isFinite(savedQrExpiry) && savedQrExpiry > Date.now()) {
        setQrCode(parsed.qrCode);
        setQrCodeExpiresAt(savedQrExpiry);
        qrAutoGenerationStarted.current = true;
      } else {
        delete parsed.qrCode;
        delete parsed.qrCodeExpiresAt;
        sessionStorage.setItem(storageKey, JSON.stringify(parsed));
      }
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

  useEffect(() => {
    if (!completionStatusPath) {
      setCompletionChecked(true);
      return;
    }
    if (!hasAction) return;
    if (!paymentIntentId) {
      setCompletionChecked(true);
      return;
    }

    setCompletionChecked(false);
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: number | null = null;
    let stopped = false;
    let inFlight = false;

    const schedule = () => {
      if (stopped) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= COMPLETION_POLL_LIMIT_MS) {
        setPollingStopped(true);
        return;
      }
      const delay = elapsed < 30_000 ? 2_000 : elapsed < 120_000 ? 5_000 : 15_000;
      timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (stopped || inFlight) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const response = await fetch(
          `${completionStatusPath}?paymentIntentId=${encodeURIComponent(paymentIntentId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const parsed = completionResponseSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success || !parsed.data.ok)
          throw new Error("status unavailable");
        const next = parsed.data.value;
        setCompletion(next);
        setPollingStopped(false);
        if (["COMPLETED", "FAILED", "EXPIRED"].includes(next.state)) {
          sessionStorage.removeItem(storageKey);
          stopped = true;
          return;
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      } finally {
        inFlight = false;
        setCompletionChecked(true);
      }
      schedule();
    };

    const pollWhenVisible = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      void poll();
    };

    document.addEventListener("visibilitychange", pollWhenVisible);
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", pollWhenVisible);
    };
  }, [completionStatusPath, hasAction, paymentIntentId, storageKey]);

  const createMethod = useCallback(
    async (attributes: Record<string, unknown>) => {
      if (!action || !publicKey) throw new Error("Payment setup is not ready.");
      const methodResponse = await fetch("https://api.paymongo.com/v1/payment_methods", {
        method: "POST",
        headers: { authorization: basic(publicKey), "content-type": "application/json" },
        body: JSON.stringify({ data: { attributes } }),
      });
      const method = (await methodResponse.json()) as PayMongoResource;
      if (!methodResponse.ok || !method.data?.id)
        throw new Error(method.errors?.[0]?.detail ?? "PayMongo could not prepare this payment.");
      return method.data.id;
    },
    [action, publicKey],
  );

  const attachMethod = useCallback(
    async (paymentMethodId: string, includeReturnUrl: boolean) => {
      if (!action || !publicKey) throw new Error("Payment setup is not ready.");
      const attachResponse = await fetch(
        `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(action.providerReference)}/attach`,
        {
          method: "POST",
          headers: { authorization: basic(publicKey), "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              attributes: {
                payment_method: paymentMethodId,
                client_key: action.clientToken,
                ...(includeReturnUrl
                  ? { return_url: `${window.location.origin}${returnPath}` }
                  : {}),
              },
            },
          }),
        },
      );
      const intent = (await attachResponse.json()) as PayMongoResource;
      if (!attachResponse.ok)
        throw new Error(intent.errors?.[0]?.detail ?? "PayMongo could not start this payment.");
      return intent;
    },
    [action, publicKey, returnPath],
  );

  const startQrPh = useCallback(
    async (replaceExpiredCode = false) => {
      if (!action || !publicKey || qrGenerationInFlight.current || (!replaceExpiredCode && qrCode))
        return;
      const actionExpiresAt = Date.parse(action.expiresAt);
      const startedAt = Date.now();
      const availableSeconds = Math.floor((actionExpiresAt - startedAt) / 1000);
      if (availableSeconds < 60) {
        sessionStorage.removeItem(storageKey);
        setAction(null);
        setQrCode(null);
        setQrCodeExpiresAt(null);
        setMessage("This payment setup has expired. Return to checkout and start again.");
        return;
      }
      const expirySeconds = Math.min(QR_PH_EXPIRY_SECONDS, availableSeconds);
      qrGenerationInFlight.current = true;
      setBusy(true);
      setMessage("");
      if (replaceExpiredCode) {
        setQrCode(null);
        setQrCodeExpiresAt(null);
        setQrRemainingSeconds(null);
      }
      try {
        const paymentMethodId = await createMethod({
          type: "qrph",
          expiry_seconds: expirySeconds,
        });
        const intent = await attachMethod(paymentMethodId, false);
        const imageUrl = intent.data?.attributes?.next_action?.code?.image_url;
        if (!imageUrl) throw new Error("PayMongo did not return a QR Ph code.");
        const expiresAt = Math.min(startedAt + expirySeconds * 1000, actionExpiresAt);
        const persistedAction = {
          ...action,
          qrCode: imageUrl,
          qrCodeExpiresAt: new Date(expiresAt).toISOString(),
        };
        sessionStorage.setItem(storageKey, JSON.stringify(persistedAction));
        setAction(persistedAction);
        setQrCode(imageUrl);
        setQrCodeExpiresAt(expiresAt);
        setMessage(
          "Scan the code in your bank or e-wallet app. We will confirm the order after PayMongo reports payment.",
        );
      } catch (error) {
        setMessage((error as Error).message);
      } finally {
        qrGenerationInFlight.current = false;
        setBusy(false);
      }
    },
    [action, attachMethod, createMethod, publicKey, qrCode, storageKey],
  );

  const method = action?.paymentMethod?.value ?? "card";
  const paymentWaiting = !completion || completion.state === "WAITING_FOR_PAYMENT";

  useEffect(() => {
    if (
      action &&
      publicKey &&
      completionChecked &&
      paymentWaiting &&
      method === "qrph" &&
      !qrCode &&
      !qrCodeExpiresAt &&
      !qrAutoGenerationStarted.current
    ) {
      qrAutoGenerationStarted.current = true;
      void startQrPh();
    }
  }, [
    action,
    completionChecked,
    method,
    paymentWaiting,
    publicKey,
    qrCode,
    qrCodeExpiresAt,
    startQrPh,
  ]);

  useEffect(() => {
    if (!qrCodeExpiresAt || !paymentWaiting) {
      setQrRemainingSeconds(null);
      return;
    }
    const update = () =>
      setQrRemainingSeconds(Math.max(0, Math.ceil((qrCodeExpiresAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [paymentWaiting, qrCodeExpiresAt]);

  useEffect(() => {
    if (!paymentWaiting || method !== "qrph" || qrRemainingSeconds !== 0 || !qrCode) return;
    void startQrPh(true);
  }, [method, paymentWaiting, qrCode, qrRemainingSeconds, startQrPh]);

  async function submitCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !publicKey) return;
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      // Historical card continuations remain client-tokenized and never cross FreshMarkets servers.
      const paymentMethodId = await createMethod({
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
      });
      const intent = await attachMethod(paymentMethodId, true);
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

      {completion?.state === "COMPLETED" && completion.orderId ? (
        <section
          aria-live="polite"
          className="grid justify-items-center gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-8 text-center"
          role="status"
        >
          <PaymentSuccessAnimation />
          <div>
            <h2 className="text-2xl font-semibold text-emerald-950">Payment successful</h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">Your order is confirmed.</p>
          </div>
          <Link
            href={`/orders/${encodeURIComponent(completion.orderId)}`}
            className="inline-flex min-h-11 items-center justify-center rounded bg-emerald-700 px-5 font-medium text-white"
          >
            View order
          </Link>
        </section>
      ) : null}

      {completion?.state === "FINALIZING_ORDER" ? (
        <section
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-6"
          role="status"
        >
          <h2 className="text-xl font-semibold text-emerald-950">Payment received</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-900">
            We’re finalizing your order now. Keep this page open and it will update automatically.
          </p>
          {pollingStopped ? (
            <Link href={donePath} className="mt-4 inline-block text-sm font-medium underline">
              Check your orders
            </Link>
          ) : null}
        </section>
      ) : null}

      {completion?.state === "FAILED" || completion?.state === "EXPIRED" ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-6" role="alert">
          <h2 className="text-xl font-semibold">Payment not completed</h2>
          <p className="mt-2 text-sm leading-6">
            This payment can no longer be completed. Return to checkout to choose a payment method.
          </p>
          <Link href={backPath} className="mt-4 inline-block text-sm font-medium underline">
            Return to checkout
          </Link>
        </section>
      ) : null}

      {paymentWaiting && completionChecked && action && publicKey && method === "qrph" ? (
        <section className="grid gap-5 rounded-lg border bg-white p-6" aria-labelledby="qrph-title">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
              Selected payment method
            </p>
            <h2 id="qrph-title" className="mt-1 text-xl font-semibold">
              QR Ph
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Scan using GCash, Maya, or any participating bank app. The generated code is
              single-use and contains the exact order amount.
            </p>
          </div>
          {qrCode ? (
            <div className="grid justify-items-center gap-4 border-t pt-5">
              {/* PayMongo returns a bounded data URL specifically for this one payment. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCode} alt="QR Ph payment code" width={280} height={280} />
              {qrRemainingSeconds !== null ? (
                <p
                  role="timer"
                  aria-label={`QR Ph code refreshes in ${countdown(qrRemainingSeconds)}`}
                  className="text-sm font-medium tabular-nums text-slate-600"
                >
                  Refreshes in {countdown(qrRemainingSeconds)}
                </p>
              ) : null}
              <Link
                href={donePath}
                className="inline-flex min-h-11 items-center justify-center rounded bg-emerald-700 px-4 font-medium text-white"
              >
                Check payment status
              </Link>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void startQrPh()}
              disabled={busy}
              className="min-h-11 rounded bg-emerald-700 px-4 font-medium text-white disabled:opacity-50"
            >
              {busy ? "Generating secure QR…" : "Try generating QR Ph again"}
            </button>
          )}
        </section>
      ) : null}

      {paymentWaiting && completionChecked && action && publicKey && method === "card" ? (
        <form onSubmit={submitCard} className="grid gap-4 rounded-lg border bg-white p-6">
          <p className="text-sm text-slate-600">
            Continue the card payment you already started before this checkout update.
          </p>
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

      {paymentWaiting &&
      completionChecked &&
      action &&
      publicKey &&
      method !== "qrph" &&
      method !== "card" ? (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          This payment method is not available in the current FreshMarkets checkout.
        </p>
      ) : null}
      {paymentWaiting && message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {completion?.state !== "COMPLETED" ? (
        <Link href={backPath} className="text-sm underline">
          Back to payment status
        </Link>
      ) : null}
    </main>
  );
}
