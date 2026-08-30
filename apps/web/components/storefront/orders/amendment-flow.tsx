"use client";

import { useRef, useState } from "react";
import type {
  OrderAmendmentDraftView,
  PaymentActionView,
  RpcResult,
} from "@freshmarkets/contracts";

export function AmendmentFlow({
  orderId,
  orderVersion,
  available,
}: {
  orderId: string;
  orderVersion: number;
  available: boolean;
}) {
  const [skuId, setSkuId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [draft, setDraft] = useState<OrderAmendmentDraftView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const draftKey = useRef<string | null>(null);
  const paymentKey = useRef<string | null>(null);

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    draftKey.current ??= `amendment-${crypto.randomUUID()}`;
    setBusy(true);
    const response = await fetch(`/api/commerce/orders/${encodeURIComponent(orderId)}/amendments`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": draftKey.current },
      body: JSON.stringify({
        expectedOrderVersion: orderVersion,
        additions: [{ skuId, quantity }],
      }),
    });
    const result = (await response.json()) as RpcResult<OrderAmendmentDraftView>;
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setDraft(result.value);
    setMessage("Review the separate addition total before payment.");
    draftKey.current = null;
  }

  async function pay() {
    if (!draft) return;
    paymentKey.current ??= `amendment-payment-${crypto.randomUUID()}`;
    setBusy(true);
    const response = await fetch(
      `/api/commerce/amendments/${encodeURIComponent(draft.amendmentId)}/payment`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": paymentKey.current },
        body: JSON.stringify({
          expectedAmendmentVersion: draft.version,
          expectedCurrency: draft.financial.currency,
          expectedTotalMinor: draft.financial.totalMinor,
          returnUrl: `${window.location.origin}/orders/${encodeURIComponent(orderId)}`,
        }),
      },
    );
    const result = (await response.json()) as RpcResult<PaymentActionView>;
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    paymentKey.current = null;
    if (result.value.actionType === "REDIRECT" && result.value.redirectUrl) {
      window.location.assign(result.value.redirectUrl);
      return;
    }
    setMessage(
      result.value.state === "PROCESSING"
        ? "Payment is processing. The addition is not committed yet."
        : "Payment started. The addition will commit only after provider confirmation.",
    );
  }

  if (!available) return null;
  return (
    <div className="mt-5 border-t border-[var(--fm-border)] pt-5">
      <h3 className="font-bold">Add items before cutoff</h3>
      {!draft ? (
        <form onSubmit={createDraft} className="mt-3 grid gap-3 sm:grid-cols-[1fr_100px_auto]">
          <label className="text-sm">
            SKU code
            <input
              required
              value={skuId}
              onChange={(e) => setSkuId(e.target.value)}
              className="mt-1 block w-full rounded-lg border p-2"
            />
          </label>
          <label className="text-sm">
            Quantity
            <input
              type="number"
              min={1}
              max={999}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border p-2"
            />
          </label>
          <button
            disabled={busy}
            className="self-end rounded-lg border px-4 py-2 font-semibold disabled:opacity-50"
          >
            Price addition
          </button>
        </form>
      ) : (
        <div className="mt-3 rounded-lg bg-[var(--fm-surface-soft)] p-4 text-sm">
          <p>
            Separate addition total:{" "}
            <strong>
              {draft.financial.currency} {(draft.financial.totalMinor / 100).toFixed(2)}
            </strong>
          </p>
          <p className="mt-1 text-[var(--fm-text-muted)]">
            The original order total remains unchanged.
          </p>
          <button
            type="button"
            onClick={() => void pay()}
            disabled={busy}
            className="mt-3 rounded-lg bg-[var(--fm-ink)] px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Accept total and pay
          </button>
        </div>
      )}
      {message ? (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
