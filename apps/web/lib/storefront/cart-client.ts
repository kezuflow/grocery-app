import type { CartView } from "@freshmarkets/contracts";

/**
 * Browser-side cart plumbing for storefront surfaces. All mutations go through
 * the Core-backed /api/commerce/cart route; this module only adds presentation
 * conveniences (count derivation, change broadcasts, auth-failure
 * classification). Cart state itself stays authoritative in Core.
 */

export const CART_CHANGED_EVENT = "fm:cart-changed";
export const STOREFRONT_TOAST_EVENT = "fm:storefront-toast";

export type StorefrontToast = {
  message: string;
  tone: "success" | "error";
  signInHref?: string;
};

export type AddToCartResult =
  | { ok: true; count: number }
  | { ok: false; reason: "unauthenticated" | "error"; message: string };

type CartRouteResult = {
  ok: boolean;
  value?: CartView;
  error?: { code?: string; message?: string };
};

export function cartCountFromView(view: CartView): number {
  return view.items.reduce((total, item) => total + item.quantity, 0);
}

/**
 * Latest known cart view on this page. Populated by fetchCart and successful
 * mutations and broadcast through CART_CHANGED_EVENT so mounted steppers can
 * hydrate without each firing their own request.
 */
let cachedCartView: CartView | null = null;

export function cachedCart(): CartView | null {
  return cachedCartView;
}

function rememberCart(view: CartView): void {
  cachedCartView = view;
  window.dispatchEvent(
    new CustomEvent(CART_CHANGED_EVENT, {
      detail: { count: cartCountFromView(view), view },
    }),
  );
}

export function quantityForSku(view: CartView, skuId: string): number {
  return view.items.find((item) => item.skuId === skuId)?.quantity ?? 0;
}

async function postCartQuantity(skuId: string, quantity: number): Promise<AddToCartResult> {
  let result: CartRouteResult;
  try {
    const response = await fetch("/api/commerce/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skuId, quantity }),
    });
    result = (await response.json()) as CartRouteResult;
  } catch {
    return { ok: false, reason: "error", message: "The cart could not be reached." };
  }
  if (result.ok && result.value) {
    rememberCart(result.value);
    return { ok: true, count: cartCountFromView(result.value) };
  }
  const code = result.error?.code ?? "ERROR";
  return {
    ok: false,
    reason: code === "UNAUTHENTICATED" ? "unauthenticated" : "error",
    message: result.error?.message ?? "Unable to update the cart.",
  };
}

/** Increment a SKU's cart quantity by one. */
export function addToCart(skuId: string, quantity: number): Promise<AddToCartResult> {
  return postCartQuantity(skuId, quantity);
}

/**
 * Load the current cart. Anonymous visitors resolve to null rather than an
 * error so surfaces can render signed-out states without console noise.
 */
export async function fetchCart(): Promise<CartView | null> {
  try {
    const response = await fetch("/api/commerce/cart");
    const result = (await response.json()) as CartRouteResult;
    if (result.ok && result.value) {
      rememberCart(result.value);
      return result.value;
    }
    cachedCartView = null;
    return null;
  } catch {
    return null;
  }
}

export function announceToast(toast: StorefrontToast): void {
  window.dispatchEvent(new CustomEvent(STOREFRONT_TOAST_EVENT, { detail: toast }));
}
