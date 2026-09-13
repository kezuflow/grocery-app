"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import { addToCart, announceToast, quantityForSku } from "../../../lib/storefront/cart-client";
import type { CatalogMedia } from "@freshmarkets/contracts";
import { useAcceptCart, useCartQuery, useInvalidateCheckoutReads } from "../../../lib/query/cart";

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
  // The header can populate the browser cache before streamed cards hydrate.
  // Keep the first render identical to SSR, then adopt that cache after hydration.
  const { cart } = useCartQuery();
  const quantity = cart ? quantityForSku(cart, skuId) : 0;
  const [pending, setPending] = useState(false);
  const acceptCart = useAcceptCart();
  const invalidateCheckout = useInvalidateCheckoutReads();

  async function mutate(next: number) {
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
      await invalidateCheckout();
      if (next > quantity) {
        announceToast({
          message: result.requiresSignIn
            ? `${productName} added to your cart. Sign in to continue when you’re ready.`
            : `${productName} added to cart.`,
          tone: "success",
          signInHref: result.requiresSignIn ? "/auth/login?returnTo=/cart" : undefined,
        });
      }
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
      onClick={() => void mutate(quantity + 1)}
      disabled={pending || unitPriceMinor == null}
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
