"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";
import {
  CART_CHANGED_EVENT,
  cartCountFromView,
  fetchCart,
} from "../../../lib/storefront/cart-client";
import type { CartView } from "@freshmarkets/contracts";

/**
 * Header cart button with a live item-count badge. Resolves to the signed-out
 * presentation for anonymous visitors; Core stays authoritative for cart state.
 */
export function CartIndicator() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    void fetchCart().then((view: CartView | null) => {
      setCount(view ? cartCountFromView(view) : 0);
    });
    const onCartChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail;
      if (typeof detail?.count === "number") setCount(detail.count);
    };
    window.addEventListener(CART_CHANGED_EVENT, onCartChanged);
    return () => window.removeEventListener(CART_CHANGED_EVENT, onCartChanged);
  }, []);

  return (
    <Link
      href="/cart"
      aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"}
      className="relative inline-flex h-10 items-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-3 text-sm font-semibold text-[var(--fm-primary-dark)] transition-colors hover:bg-[#a9e83f]"
    >
      <ShoppingCart className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">Cart</span>
      {count ? (
        <span className="rounded-full bg-[var(--fm-primary-dark)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
