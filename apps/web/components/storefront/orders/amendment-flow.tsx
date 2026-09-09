"use client";

import { useRef, useState } from "react";
import { appErrorCodes, paymentStates } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";

const failure = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(appErrorCodes), message: z.string() }),
});
const option = z.object({
  skuId: z.string(),
  productName: z.string(),
  variantName: z.string(),
  priceMinor: z.number().int().safe().positive(),
  currency: z.string(),
});
const optionsResponse = z.union([
  failure,
  z.object({
    ok: z.literal(true),
    value: z.object({ items: z.array(option), hasMore: z.boolean() }),
  }),
]);
const draftValue = z.object({
  amendmentId: z.string(),
  version: z.number().int().positive(),
  financial: z.object({ currency: z.string(), totalMinor: z.number().int().safe().nonnegative() }),
  lines: z.array(
    z.object({
      productName: z.string(),
      variantName: z.string(),
      quantity: z.number().int().positive(),
    }),
  ),
});
const draftResponse = z.union([failure, z.object({ ok: z.literal(true), value: draftValue })]);
const paymentResponse = z.union([
  failure,
  z.object({
    ok: z.literal(true),
    value: z.object({
      paymentIntentId: z.string(),
      state: z.enum(paymentStates).exclude(["REFUNDED", "PARTIALLY_REFUNDED"]),
      actionType: z.enum(["NONE", "REDIRECT", "SDK"]),
      redirectUrl: z.url().nullable(),
      clientToken: z.string().nullable(),
      expiresAt: z.string().nullable(),
    }),
  }),
]);
type SavedRequest = { key: string; body: string };
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(minor / 100);

export function AmendmentFlow({
  orderId,
  orderVersion,
  available,
}: {
  orderId: string;
  orderVersion: number;
  available: boolean;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<z.infer<typeof option>[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [skuId, setSkuId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [draft, setDraft] = useState<z.infer<typeof draftValue> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const draftRequest = useRef<SavedRequest | null>(null);
  const paymentRequest = useRef<SavedRequest | null>(null);
  const endpoint = `/api/commerce/orders/${encodeURIComponent(orderId)}/amendments`;

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || uncertain) return;
    inFlight.current = true;
    setBusy(true);
    setOptions([]);
    setSkuId("");
    setHasMore(false);
    try {
      const response = await fetch(`${endpoint}?query=${encodeURIComponent(query.trim())}`);
      const result = optionsResponse.parse(await response.json());
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setOptions(result.value.items);
      setSkuId(result.value.items[0]?.skuId ?? "");
      setHasMore(result.value.hasMore);
      setMessage(
        result.value.items.length
          ? "Choose a product and quantity. The total is checked before payment."
          : "No available products match. Try another name.",
      );
    } catch {
      setMessage("Products could not be loaded. Search again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    draftRequest.current ??= {
      key: `amendment-${crypto.randomUUID()}`,
      body: JSON.stringify({
        expectedOrderVersion: orderVersion,
        additions: [{ skuId, quantity }],
      }),
    };
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": draftRequest.current.key,
        },
        body: draftRequest.current.body,
      });
      const result = draftResponse.parse(await response.json());
      if (!result.ok) {
        // Only definite rejection permits a different draft. An uncertain reply
        // retains the original body/key behind the same ordinary action.
        const rejected = [
          "VALIDATION_FAILED",
          "UNAVAILABLE_ITEM",
          "PRICE_UNAVAILABLE",
          "STALE_VERSION",
          "CYCLE_CLOSED",
          "ILLEGAL_TRANSITION",
        ].includes(result.error.code);
        if (rejected) draftRequest.current = null;
        setUncertain(!rejected);
        setMessage(result.error.message);
        return;
      }
      setDraft(result.value);
      setUncertain(false);
      setMessage("Review the separate addition total before payment.");
    } catch {
      setUncertain(true);
      setMessage(
        "The addition could not be confirmed. Use Price addition again to check the same request.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function pay() {
    if (!draft || inFlight.current) return;
    paymentRequest.current ??= {
      key: `amendment-payment-${crypto.randomUUID()}`,
      body: JSON.stringify({
        expectedAmendmentVersion: draft.version,
        expectedCurrency: draft.financial.currency,
        expectedTotalMinor: draft.financial.totalMinor,
        returnUrl: `${window.location.origin}/orders/${encodeURIComponent(orderId)}`,
      }),
    };
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/commerce/amendments/${encodeURIComponent(draft.amendmentId)}/payment`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": paymentRequest.current.key,
          },
          body: paymentRequest.current.body,
        },
      );
      const result = paymentResponse.parse(await response.json());
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      if (result.value.actionType === "REDIRECT" && result.value.redirectUrl) {
        const url = new URL(result.value.redirectUrl);
        if (
          url.protocol !== "https:" &&
          !(url.protocol === "http:" && url.origin === window.location.origin)
        )
          throw new Error("Invalid payment redirect");
        window.location.assign(url.href);
      } else if (result.value.actionType === "SDK" && result.value.clientToken) {
        sessionStorage.setItem("freshmarkets.checkoutPaymentAction", JSON.stringify(result.value));
        window.location.assign("/checkout/payment");
      } else if (result.value.actionType !== "NONE") {
        throw new Error("Missing payment action");
      } else if (result.value.state === "FAILED" || result.value.state === "EXPIRED") {
        setMessage(
          "This payment did not complete. Refresh your order before trying another addition.",
        );
      } else {
        setMessage(
          result.value.state === "SUCCEEDED"
            ? "Payment was received. Check your order while the addition is finalized."
            : "Payment is awaiting confirmation. Check your order for the addition's latest status.",
        );
      }
    } catch {
      setMessage(
        "Payment could not be confirmed. Use Accept total and pay again to check the same request.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!available) return null;
  return (
    <section
      aria-label="Add items before cutoff"
      className="mt-5 border-t border-[var(--fm-border)] pt-5"
    >
      <h3 className="font-bold">Add items before cutoff</h3>
      {!draft ? (
        <>
          <form onSubmit={search} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm">
              Find a product
              <input
                required
                maxLength={100}
                value={query}
                disabled={busy || uncertain}
                onChange={(event) => setQuery(event.target.value)}
                className="mt-1 block w-full rounded-lg border p-2"
              />
            </label>
            <button
              disabled={busy || uncertain}
              className="min-h-11 rounded-lg border px-4 font-semibold disabled:opacity-50"
            >
              Search products
            </button>
          </form>
          {hasMore ? (
            <p className="mt-2 text-sm">
              Showing the first 25 options. Use a more specific product name to narrow the results.
            </p>
          ) : null}
          {options.length ? (
            <form
              onSubmit={createDraft}
              className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_auto]"
            >
              <label className="min-w-0 text-sm">
                Product to add
                <select
                  required
                  value={skuId}
                  disabled={busy || uncertain}
                  onChange={(event) => setSkuId(event.target.value)}
                  className="mt-1 block w-full rounded-lg border p-2"
                >
                  {options.map((item) => (
                    <option key={item.skuId} value={item.skuId}>
                      {item.productName} · {item.variantName} ·{" "}
                      {money(item.priceMinor, item.currency)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Quantity
                <input
                  type="number"
                  min={1}
                  max={999}
                  required
                  value={quantity}
                  disabled={busy || uncertain}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  className="mt-1 block w-full rounded-lg border p-2"
                />
              </label>
              <button
                disabled={busy}
                className="min-h-11 self-end rounded-lg border px-4 py-2 font-semibold disabled:opacity-50"
              >
                Price addition
              </button>
            </form>
          ) : null}
        </>
      ) : (
        <div className="mt-3 rounded-lg bg-[var(--fm-surface-soft)] p-4 text-sm">
          <ul>
            {draft.lines.map((line, index) => (
              <li key={index}>
                {line.quantity} × {line.productName} · {line.variantName}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Separate addition total:{" "}
            <strong>{money(draft.financial.totalMinor, draft.financial.currency)}</strong>
          </p>
          <p className="mt-1 text-[var(--fm-text-muted)]">
            The original order total remains unchanged.
          </p>
          <button
            type="button"
            onClick={() => void pay()}
            disabled={busy}
            className="mt-3 min-h-11 rounded-lg bg-[var(--fm-ink)] px-4 py-2 font-semibold text-white disabled:opacity-50"
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
    </section>
  );
}
