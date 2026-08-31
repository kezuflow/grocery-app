"use client";

import { useRef, useState } from "react";
import type {
  CustomerOrderDetailView,
  OrderCancellationView,
  RpcResult,
} from "@freshmarkets/contracts";

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

function disabledMessage(reason: string | null): string {
  return (
    {
      CANCELLATION_WINDOW_CLOSED: "The cancellation window has closed.",
      REFUND_ALREADY_IN_PROGRESS: "A refund is already being processed for this order.",
      CANCELLATION_ALREADY_REQUESTED: "Cancellation is already being processed.",
      CANCELLATION_CONFIGURATION_UNAVAILABLE: "Cancellation details are temporarily unavailable.",
      ORDER_NOT_CANCELABLE: "This order can no longer be canceled.",
    }[reason ?? ""] ?? "This order cannot be canceled online."
  );
}

export function cancellationResultMessage(result: RpcResult<OrderCancellationView>): string {
  if (!result.ok)
    return result.error.code === "STALE_VERSION"
      ? "The order changed. Refresh the page before trying again."
      : result.error.message;
  return result.value.status === "COMPLETED"
    ? "Cancellation completed and the refund was confirmed."
    : "Cancellation requested. Refunds are processing; the order is not marked canceled yet.";
}

export function CancelOrderAction({
  orderId,
  orderVersion,
  available,
  disabledReason,
  cancellation,
}: {
  orderId: string;
  orderVersion: number;
  available: boolean;
  disabledReason: string | null;
  cancellation: CustomerOrderDetailView["cancellation"];
}) {
  const key = useRef<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    if (!reason.trim()) {
      setMessage("Enter a reason for canceling this order.");
      return;
    }
    key.current ??= `cancel-${crypto.randomUUID()}`;
    setBusy(true);
    try {
      const response = await fetch(`/api/commerce/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key.current },
        body: JSON.stringify({ expectedVersion: orderVersion, reason: reason.trim() }),
      });
      const result = (await response.json()) as RpcResult<OrderCancellationView>;
      if (!result.ok && result.error.code === "STALE_VERSION") key.current = null;
      setMessage(cancellationResultMessage(result));
      if (result.ok) setConfirming(false);
    } catch {
      setMessage("Cancellation could not be requested. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!available)
    return (
      <div className="rounded-lg border border-[var(--fm-border)] p-3 text-sm">
        <p className="font-semibold">Cancel order</p>
        <p className="mt-1 text-[var(--fm-text-muted)]">{disabledMessage(disabledReason)}</p>
      </div>
    );

  if (cancellation.requiredRefundMinor === null || cancellation.retainedServiceFeeMinor === null)
    return null;

  return (
    <div className="rounded-lg border border-[var(--fm-border)] p-4 text-sm">
      <p className="font-semibold">Cancel order</p>
      <dl className="mt-3 space-y-1">
        <div className="flex justify-between gap-3">
          <dt>Refund if canceled now</dt>
          <dd className="font-semibold tabular-nums">
            {money(cancellation.requiredRefundMinor, cancellation.currency)}
          </dd>
        </div>
        {cancellation.retainedServiceFeeMinor > 0 ? (
          <div className="flex justify-between gap-3 text-[var(--fm-text-muted)]">
            <dt>FreshMarkets service fee retained</dt>
            <dd className="tabular-nums">
              {money(cancellation.retainedServiceFeeMinor, cancellation.currency)}
            </dd>
          </div>
        ) : null}
      </dl>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 min-h-11 rounded-[var(--fm-radius-control)] border border-red-700 px-4 font-bold text-red-800"
        >
          Cancel order
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block font-semibold" htmlFor={`cancel-reason-${orderId}`}>
            Reason for cancellation
          </label>
          <textarea
            id={`cancel-reason-${orderId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] p-3"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="min-h-11 rounded-[var(--fm-radius-control)] bg-red-700 px-4 font-bold text-white disabled:opacity-50"
            >
              {busy ? "Requesting cancellation…" : "Confirm cancellation"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="min-h-11 rounded-[var(--fm-radius-control)] px-4 font-semibold underline"
            >
              Keep order
            </button>
          </div>
        </div>
      )}
      <div aria-live="polite" className="mt-3">
        {message ? <p>{message}</p> : null}
      </div>
    </div>
  );
}
