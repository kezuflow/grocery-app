"use client";

import { useRef, useState } from "react";
import type { CartView } from "@freshmarkets/contracts";
import { addToCart, quantityForSku } from "../storefront/cart-client";
import { useAcceptCart } from "./cart";

export type PendingCartQuantity = {
  item: CartView["items"][number];
  quantity: number;
  currency: string;
};

type QueueOptions = {
  beforeStart?: () => Promise<boolean>;
  afterDrained?: (view: CartView) => Promise<void>;
  onStart?: () => void;
  onFailure: (message: string) => void;
};

/** Serialize versioned Core writes while every tap updates the requested count immediately. */
export function useCartQuantityQueue(options: QueueOptions) {
  const acceptCart = useAcceptCart();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const requested = useRef(new Map<string, PendingCartQuantity>());
  const running = useRef(false);
  const confirmedView = useRef<CartView | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingCartQuantity>>(new Map());
  const [busy, setBusy] = useState(false);

  function publishPending() {
    setPending(new Map(requested.current));
  }

  async function drain() {
    let lastAccepted: CartView | null = null;
    let needsAfterDrained = false;
    try {
      optionsRef.current.onStart?.();
      if ((await optionsRef.current.beforeStart?.()) === false) return;
      while (true) {
        while (requested.current.size) {
          const [skuId, request] = requested.current.entries().next().value!;
          const confirmed = lastAccepted
            ? quantityForSku(lastAccepted, skuId)
            : request.item.quantity;
          if (request.quantity !== confirmed) {
            const result = await addToCart(skuId, request.quantity, {
              name: request.item.name,
              media: request.item.media,
              unitPriceMinor: request.item.unitPriceMinor,
              currency: request.currency,
            });
            if (!result.ok) {
              optionsRef.current.onFailure(result.message);
              return;
            }
            lastAccepted = result.view;
            confirmedView.current = result.view;
            needsAfterDrained = true;
            acceptCart(result.view);
            if (quantityForSku(result.view, skuId) !== request.quantity) {
              optionsRef.current.onFailure(
                "The cart returned a different quantity. Review your cart before editing.",
              );
              return;
            }
          }
          const latest = requested.current.get(skuId);
          if (!latest) continue;
          const current = lastAccepted ? quantityForSku(lastAccepted, skuId) : latest.item.quantity;
          requested.current.delete(skuId);
          if (latest.quantity !== current) requested.current.set(skuId, latest);
          publishPending();
        }
        if (needsAfterDrained && lastAccepted) {
          await optionsRef.current.afterDrained?.(lastAccepted);
          needsAfterDrained = false;
        }
        // A tap can arrive while checkout reads are being invalidated.
        if (!requested.current.size) return;
      }
    } catch {
      optionsRef.current.onFailure(
        lastAccepted
          ? "Cart updated. Refresh checkout details before continuing."
          : "The quantity update is not confirmed yet. Retry the same quantity.",
      );
    } finally {
      requested.current.clear();
      publishPending();
      running.current = false;
      confirmedView.current = null;
      setBusy(false);
    }
  }

  function request(item: CartView["items"][number], quantity: number, currency: string) {
    const delta = quantity - item.quantity;
    if (delta !== 1 && delta !== -1) return;
    const previous = requested.current.get(item.skuId);
    const confirmed =
      running.current && confirmedView.current
        ? quantityForSku(confirmedView.current, item.skuId)
        : item.quantity;
    const next = (previous?.quantity ?? confirmed) + delta;
    if (next < 0 || !Number.isSafeInteger(next)) return;
    requested.current.set(item.skuId, {
      item: previous?.item ?? item,
      quantity: next,
      currency,
    });
    publishPending();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void drain();
  }

  return { request, pending, busy };
}

/** Keep a removed line visible if its queued next target adds it back. */
export function cartItemsWithPending(
  cart: CartView | null,
  pending: ReadonlyMap<string, PendingCartQuantity>,
): CartView["items"] {
  const items = [...(cart?.items ?? [])];
  for (const [skuId, request] of pending) {
    if (!items.some((item) => item.skuId === skuId)) items.push(request.item);
  }
  return items;
}
