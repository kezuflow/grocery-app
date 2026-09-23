"use client";

import { useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  addToCart,
  announceToast,
  cachedCart,
  quantityForSku,
} from "../../../lib/storefront/cart-client";
import type { CatalogMedia } from "@freshmarkets/contracts";
import { useAcceptCart, useInvalidateCheckoutReads } from "../../../lib/query/cart";

/** Product cards keep a compact plus button; cart quantities are edited in the cart. */
export function AddToCartButton({
  skuId,
  productName,
  media,
  unitPriceMinor,
  currency = "PHP",
  className,
}: {
  skuId: string;
  productName: string;
  media?: CatalogMedia | null;
  unitPriceMinor?: number | null;
  currency?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const acceptCart = useAcceptCart();
  const invalidateCheckout = useInvalidateCheckoutReads();

  async function mutate() {
    // Product cards do not display Cart state, so subscribing every card to the
    // complete Cart makes the whole grid re-render after each click. Read the
    // shared authoritative projection only when the user acts.
    const current = cachedCart();
    const quantity = current ? quantityForSku(current, skuId) : 0;
    const next = quantity + 1;
    setPending(true);
    const result = await addToCart(skuId, next, {
      name: productName,
      media,
      unitPriceMinor: unitPriceMinor ?? null,
      currency,
    });
    setPending(false);
    if (result.ok) {
      acceptCart(result.view);
      if (next > quantity) {
        announceToast({
          message: result.requiresSignIn
            ? `${productName} added to your cart. Sign in to continue when you’re ready.`
            : `${productName} added to cart.`,
          tone: "success",
          signInHref: result.requiresSignIn ? "/auth/login?returnTo=/cart" : undefined,
        });
      }
      await invalidateCheckout();
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

  return (
    <button
      type="button"
      onClick={() => void mutate()}
      disabled={pending || unitPriceMinor == null}
      aria-busy={pending}
      aria-label={pending ? `Adding ${productName} to cart` : `Add ${productName} to cart`}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white text-[var(--fm-primary-dark)] shadow-sm transition-[background-color,border-color,transform] duration-(--fm-motion-fast) ease-(--fm-ease-out) hover:border-[var(--fm-primary-dark)] hover:bg-[var(--fm-hover)] active:scale-[0.97] disabled:active:scale-100 disabled:opacity-60 motion-reduce:active:scale-100",
        className,
      )}
    >
      {pending ? (
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <Plus className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
