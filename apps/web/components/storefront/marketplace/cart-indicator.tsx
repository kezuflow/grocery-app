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
      className="relative inline-flex h-11 items-center rounded-full p-2.5 text-sm font-semibold text-[var(--fm-text)] transition-colors hover:text-[var(--fm-primary-dark)]"
    >
      <span className="relative inline-flex">
        <ShoppingCart className="size-6" aria-hidden="true" />
        {count ? (
          <span className="absolute -top-2.5 -right-2.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--fm-primary-dark)] px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
            {count}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
