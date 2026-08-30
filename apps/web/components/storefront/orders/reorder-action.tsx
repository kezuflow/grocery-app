"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { CartView, ReorderResultView, RpcResult } from "@freshmarkets/contracts";

function reasonLabel(reason: ReorderResultView["skippedLines"][number]["reason"]): string {
  return {
    SKU_INACTIVE: "no longer sold",
    PRODUCT_INACTIVE: "product no longer sold",
    LOCATION_UNAVAILABLE: "unavailable for the current cart",
    PRICE_UNAVAILABLE: "current price unavailable",
    INVALID_HISTORICAL_QUANTITY: "historical quantity unavailable",
  }[reason];
}

export function reorderResultMessage(result: ReorderResultView): string {
  if (result.outcome === "NO_ITEMS_ADDED")
    return `No items were added. ${result.skippedLines.map((line) => `${line.productName}: ${reasonLabel(line.reason)}`).join("; ")}`;
  const added = result.addedLines.reduce((total, line) => total + line.quantityAdded, 0);
  if (result.outcome === "PARTIAL")
    return `${added} item${added === 1 ? "" : "s"} added at current prices. ${result.skippedLines.length} line${result.skippedLines.length === 1 ? " was" : "s were"} skipped; review the current cart.`;
  return `${added} item${added === 1 ? "" : "s"} added at current prices. Review delivery and address details in the current cart.`;
}

export function ReorderAction({ orderId, available }: { orderId: string; available: boolean }) {
  const key = useRef(`reorder-${crypto.randomUUID()}`);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReorderResultView | null>(null);
  const [message, setMessage] = useState("");

  async function reorder() {
    setBusy(true);
    try {
      const cartResponse = await fetch("/api/commerce/cart", { cache: "no-store" });
      const cart = (await cartResponse.json()) as RpcResult<CartView>;
      if (!cart.ok) {
        setMessage(cart.error.message);
        return;
      }
      const response = await fetch(`/api/commerce/orders/${encodeURIComponent(orderId)}/reorder`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key.current },
        body: JSON.stringify({ expectedCartVersion: cart.value.version }),
      });
      const reordered = (await response.json()) as RpcResult<ReorderResultView>;
      if (!reordered.ok) {
        if (reordered.error.code === "CART_VERSION_CONFLICT")
          key.current = `reorder-${crypto.randomUUID()}`;
        setMessage(reordered.error.message);
        return;
      }
      setResult(reordered.value);
      setMessage(reorderResultMessage(reordered.value));
    } catch {
      setMessage("The order could not be added to your cart. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={reorder}
        disabled={!available || busy}
        className="min-h-11 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Checking current items…" : "Buy again"}
      </button>
      <div aria-live="polite" className="mt-3 text-sm">
        {message ? <p>{message}</p> : null}
        {result && result.addedLines.length > 0 ? (
          <Link
            href="/cart"
            className="mt-2 inline-flex font-semibold underline underline-offset-4"
          >
            Review current cart
          </Link>
        ) : null}
      </div>
    </div>
  );
}
