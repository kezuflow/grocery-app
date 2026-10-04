"use client";

import type { CheckoutPaymentCompletionView } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import Link from "next/link";
import { useEffect, useState } from "react";

const POLL_LIMIT_MS = 20 * 60_000;
const completionSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      paymentIntentId: z.string(),
      state: z.enum(["WAITING_FOR_PAYMENT", "FINALIZING_ORDER", "COMPLETED", "FAILED", "EXPIRED"]),
      orderId: z.string().nullable(),
      qrGenerationAllowed: z.boolean().default(false),
      qrGenerationEndsAt: z.string().nullable().default(null),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);

export function PaymentReturnStatus({
  paymentIntentId,
  onCompleted,
}: {
  paymentIntentId: string | null;
  onCompleted(): void;
}) {
  const [result, setResult] = useState<CheckoutPaymentCompletionView | null>(null);
  const [error, setError] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!paymentIntentId) return;
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: number | null = null;
    let inFlight = false;
    let finished = false;
    const schedule = () => {
      if (finished) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= POLL_LIMIT_MS) {
        setStopped(true);
        return;
      }
      const delay = elapsed < 30_000 ? 2_000 : elapsed < 120_000 ? 5_000 : 15_000;
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (finished || inFlight) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const response = await fetch(
          `/api/checkout/payment/status?paymentIntentId=${encodeURIComponent(paymentIntentId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const parsed = completionSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success || !parsed.data.ok)
          throw new Error("Payment status unavailable");
        if (parsed.data.value.paymentIntentId !== paymentIntentId)
          throw new Error("Payment status identity mismatch");
        const next = parsed.data.value;
        setResult(next);
        setError(false);
        setStopped(false);
        if (next.state === "COMPLETED" && next.orderId) {
          finished = true;
          onCompleted();
          return;
        }
        if (next.state === "FAILED" || next.state === "EXPIRED") {
          finished = true;
          return;
        }
      } catch (cause) {
        if ((cause as Error).name === "AbortError") return;
        setError(true);
      } finally {
        inFlight = false;
      }
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || finished) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      finished = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [paymentIntentId, retry, onCompleted]);

  if (!paymentIntentId)
    return (
      <section role="status" className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold">Check your payment</h2>
        <p className="mt-2 text-sm text-slate-600">
          This return did not include a payment reference. Check your orders and any checkout still
          awaiting payment; a provider return alone does not confirm an order.
        </p>
        <Link href="/orders?filter=incomplete" className="mt-3 inline-block text-sm underline">
          View checkouts awaiting payment
        </Link>
      </section>
    );

  const state = result?.state;
  return (
    <section role="status" aria-live="polite" className="rounded-lg border bg-white p-5">
      <h2 className="font-semibold">
        {state === "COMPLETED" && result?.orderId
          ? "Order confirmed"
          : state === "FINALIZING_ORDER"
            ? "Payment received"
            : state === "FAILED" || state === "EXPIRED"
              ? "Payment not completed"
              : "Checking payment"}
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        {state === "COMPLETED" && result?.orderId
          ? "Your payment and order are confirmed."
          : state === "FINALIZING_ORDER"
            ? "We are finalizing your order. This page will update after it is confirmed."
            : state === "FAILED" || state === "EXPIRED"
              ? "This payment cannot be completed. Review your checkout before trying again."
              : state === "WAITING_FOR_PAYMENT"
                ? "The provider has not confirmed payment yet. Finish any remaining payment step."
                : "We are checking the provider-confirmed status of this payment."}
      </p>
      {state === "COMPLETED" && result?.orderId ? (
        <Link
          href={`/orders/${encodeURIComponent(result.orderId)}`}
          className="mt-3 inline-block text-sm font-semibold underline"
        >
          View confirmed order
        </Link>
      ) : null}
      {state === "FAILED" || state === "EXPIRED" ? (
        <Link href="/checkout" className="mt-3 inline-block text-sm font-semibold underline">
          Return to checkout
        </Link>
      ) : null}
      {error || stopped ? (
        <div className="mt-3 text-sm">
          <p>{stopped ? "Automatic checking paused." : "The latest status could not be loaded."}</p>
          <button
            type="button"
            className="mt-1 font-semibold underline"
            onClick={() => setRetry((value) => value + 1)}
          >
            Check again
          </button>
        </div>
      ) : null}
    </section>
  );
}
