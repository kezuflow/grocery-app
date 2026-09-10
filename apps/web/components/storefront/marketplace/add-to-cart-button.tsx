"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  CART_CHANGED_EVENT,
  addToCart,
  announceToast,
  cachedCart,
  quantityForSku,
} from "../../../lib/storefront/cart-client";
import type { CartView, CatalogMedia } from "@freshmarkets/contracts";

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
  const [quantity, setQuantity] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const view = cachedCart();
    setQuantity(view ? quantityForSku(view, skuId) : 0);
    const onCartChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: CartView | null }>).detail;
      setQuantity(detail?.view ? quantityForSku(detail.view, skuId) : 0);
    };
    window.addEventListener(CART_CHANGED_EVENT, onCartChanged);
    return () => window.removeEventListener(CART_CHANGED_EVENT, onCartChanged);
  }, [skuId]);

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
