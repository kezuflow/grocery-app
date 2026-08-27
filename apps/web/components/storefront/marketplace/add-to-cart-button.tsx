"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  CART_CHANGED_EVENT,
  addToCart,
  announceToast,
  cachedCart,
  quantityForSku,
} from "../../../lib/storefront/cart-client";
import type { CartView } from "@freshmarkets/contracts";

/**
 * Compact add control that becomes a quantity stepper in the same stable
 * footprint once the SKU is in the cart. Optimistic display only — Core owns
 * the authoritative quantity and recalculates at checkout.
 */
export function AddToCartButton({
  skuId,
  productName,
  unitPriceMinor,
  currency = "PHP",
  className,
}: {
  skuId: string;
  productName: string;
  unitPriceMinor?: number | null;
  currency?: string;
  className?: string;
}) {
  const [quantity, setQuantity] = useState(() => {
    const view = cachedCart();
    return view ? quantityForSku(view, skuId) : 0;
  });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onCartChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: CartView }>).detail;
      if (detail?.view) setQuantity(quantityForSku(detail.view, skuId));
    };
    window.addEventListener(CART_CHANGED_EVENT, onCartChanged);
    return () => window.removeEventListener(CART_CHANGED_EVENT, onCartChanged);
  }, [skuId]);

  async function mutate(next: number) {
    setPending(true);
    const result = await addToCart(skuId, next, {
      name: productName,
      unitPriceMinor: unitPriceMinor ?? 0,
      currency,
    });
    setPending(false);
    if (result.ok) {
      if (next > quantity) {
        announceToast({
          message: result.requiresSignIn
            ? `${productName} added to your cart. Sign in to continue when you’re ready.`
            : `${productName} added to cart.`,
          tone: "success",
          signInHref: result.requiresSignIn ? "/auth/login?returnTo=/cart" : undefined,
        });
      }
      setQuantity(next);
      return;
    }
    if (result.reason === "unauthenticated") {
      announceToast({
        message: "Sign in to add items to your cart.",
        tone: "error",
        signInHref: "/auth/login",
      });
      return;
    }
    announceToast({ message: result.message, tone: "error" });
  }

  if (quantity <= 0) {
    return (
      <button
        type="button"
        onClick={() => void mutate(1)}
        disabled={pending}
        aria-label={`Add ${productName} to cart`}
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white text-[var(--fm-primary-dark)] shadow-sm transition-colors hover:border-[var(--fm-primary-dark)] hover:bg-[var(--fm-primary-lime)] disabled:opacity-60",
          className,
        )}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex h-10 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => void mutate(quantity - 1)}
        disabled={pending}
        aria-label={`Remove one ${productName}`}
        className="inline-flex size-10 items-center justify-center rounded-l-[var(--fm-radius-control)] text-[var(--fm-primary-dark)] hover:bg-[var(--fm-hover)] disabled:opacity-60"
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <span className="min-w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => void mutate(quantity + 1)}
        disabled={pending}
        aria-label={`Add another ${productName}`}
        className="inline-flex size-10 items-center justify-center rounded-r-[var(--fm-radius-control)] text-[var(--fm-primary-dark)] hover:bg-[var(--fm-hover)] disabled:opacity-60"
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
