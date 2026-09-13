"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { CART_DRAWER_REQUEST_EVENT, cartCountFromView } from "../../../lib/storefront/cart-client";
import { useCartQuery } from "../../../lib/query/cart";

/**
 * Header cart button with a live item-count badge. Resolves to the signed-out
 * presentation for anonymous visitors; Core stays authoritative for cart state.
 */
export function CartIndicator() {
  const { cart } = useCartQuery();
  const count = cart ? cartCountFromView(cart) : 0;

  return (
    <Link
      href="/cart"
      aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT));
      }}
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
