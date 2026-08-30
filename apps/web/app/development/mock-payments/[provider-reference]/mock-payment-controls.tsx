"use client";

import type {
  MockPaymentOutcome,
  MockPaymentSimulationView,
  RpcResult,
} from "@freshmarkets/contracts";
import Link from "next/link";
import { useRef, useState } from "react";

export function MockPaymentControls({
  providerReference,
  returnTo,
}: {
  providerReference: string;
  returnTo: string;
}) {
  const keys = useRef<Partial<Record<MockPaymentOutcome, string>>>({});
  const [pending, setPending] = useState<MockPaymentOutcome | null>(null);
  const [result, setResult] = useState<MockPaymentSimulationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function simulate(outcome: MockPaymentOutcome) {
    setPending(outcome);
    setError(null);
    keys.current[outcome] ??= `mock-simulator-${crypto.randomUUID()}`;
    try {
      const response = await fetch(
        `/api/development/mock-payments/${encodeURIComponent(providerReference)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": keys.current[outcome],
          },
          body: JSON.stringify({ outcome }),
        },
      );
      const body = (await response.json()) as RpcResult<MockPaymentSimulationView>;
      if (!body.ok) throw new Error(body.error.message);
      setResult(body.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The test event could not be submitted.");
    } finally {
      setPending(null);
    }
  }

  const orderHref = result?.committedOrderId ? `/orders/${result.committedOrderId}` : returnTo;
  return (
    <section className="rounded-[var(--fm-radius-overlay)] border border-[var(--fm-border)] bg-white p-6 shadow-[var(--fm-shadow-card)]">
      <p className="text-sm text-[var(--fm-text-muted)]">
        This local-only screen sends a signed mock provider event through Core. It cannot choose the
        payment amount, currency, customer, or payment identity.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void simulate("SUCCEEDED")}
          className="min-h-11 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {pending === "SUCCEEDED" ? "Approving…" : "Approve test payment"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void simulate("FAILED")}
          className="min-h-11 rounded-[var(--fm-radius-control)] border border-[var(--fm-danger-border)] bg-[var(--fm-danger-soft)] px-4 py-2 font-semibold text-[var(--fm-destructive)] disabled:opacity-50"
        >
          {pending === "FAILED" ? "Declining…" : "Decline test payment"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void simulate("EXPIRED")}
          className="min-h-11 rounded-[var(--fm-radius-control)] border border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] px-4 py-2 font-semibold text-[var(--fm-warning)] disabled:opacity-50"
        >
          {pending === "EXPIRED" ? "Expiring…" : "Expire test payment"}
        </button>
      </div>
      {result ? (
        <div
          role="status"
          className="mt-6 rounded-[var(--fm-radius-surface)] border border-[var(--fm-success-border)] bg-[var(--fm-success-soft)] p-4"
        >
          <p className="font-semibold">
            {result.outcome === "SUCCEEDED"
              ? result.committedOrderId
                ? "Order confirmed"
                : "Test payment approved"
              : result.outcome === "FAILED"
                ? "Test payment declined"
                : "Test payment expired"}
          </p>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            Core recorded the verified provider outcome as {result.processingStatus.toLowerCase()}.
          </p>
          <Link href={orderHref} className="mt-3 inline-flex font-semibold underline">
            Return to FreshMarkets
          </Link>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-5 text-sm font-semibold text-[var(--fm-destructive)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
