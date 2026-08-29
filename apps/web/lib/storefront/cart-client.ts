import type { CartView } from "@freshmarkets/contracts";

/**
 * Browser-side cart plumbing for storefront surfaces. All mutations go through
 * the Core-backed /api/commerce/cart route; this module only adds presentation
 * conveniences (count derivation, change broadcasts, auth-failure
 * classification). Cart state itself stays authoritative in Core.
 */

export const CART_CHANGED_EVENT = "fm:cart-changed";
export const CART_DRAWER_REQUEST_EVENT = "fm:cart-drawer-request";
export const STOREFRONT_TOAST_EVENT = "fm:storefront-toast";

export type StorefrontToast = {
  message: string;
  tone: "success" | "error";
  signInHref?: string;
};

export type AddToCartResult =
  | { ok: true; count: number; requiresSignIn?: boolean }
  | { ok: false; reason: "unauthenticated" | "error"; message: string };

export type GuestCartItem = {
  skuId: string;
  quantity: number;
  name: string;
  availability: "AVAILABLE" | "UNAVAILABLE" | "PRICE_UNAVAILABLE";
  unitPriceMinor: number | null;
  currency: string;
  lineTotalMinor: number | null;
};

export type CartItemMetadata = Pick<GuestCartItem, "name" | "unitPriceMinor" | "currency">;

const GUEST_CART_KEY = "freshmarkets.guest-cart.v1";

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

function guestCartView(): CartView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { items?: GuestCartItem[] };
    if (!Array.isArray(parsed.items)) return null;
    const items = parsed.items
      .filter(
        (item) =>
          typeof item?.skuId === "string" &&
          typeof item?.quantity === "number" &&
          item.quantity > 0 &&
          typeof item?.name === "string" &&
          (typeof item?.unitPriceMinor === "number" || item?.unitPriceMinor === null) &&
          typeof item?.currency === "string",
      )
      .map((item) => ({
        ...item,
        availability:
          item.availability ??
          (item.unitPriceMinor === null ? "PRICE_UNAVAILABLE" : "AVAILABLE"),
        lineTotalMinor:
          item.unitPriceMinor === null ? null : item.quantity * item.unitPriceMinor,
      }));
    if (items.length === 0) return null;
    return {
      id: "guest-cart",
      version: 1,
      items,
      totalMinor: items.reduce((total, item) => total + (item.lineTotalMinor ?? 0), 0),
      currency: items[0]?.currency ?? "PHP",
      checkoutBlocked: items.some((item) => item.availability !== "AVAILABLE"),
      blockingReasons: [
        ...(items.some((item) => item.availability === "UNAVAILABLE")
          ? (["ITEM_UNAVAILABLE"] as const)
          : []),
        ...(items.some((item) => item.availability === "PRICE_UNAVAILABLE")
          ? (["PRICE_UNAVAILABLE"] as const)
          : []),
      ],
    };
  } catch {
    return null;
  }
}

function rememberGuestItem(skuId: string, quantity: number, metadata?: CartItemMetadata): CartView {
  const current = guestCartView();
  const items: GuestCartItem[] = current?.items
    ? current.items.map((item) => ({ ...item, currency: current.currency }))
    : [];
  const index = items.findIndex((item) => item.skuId === skuId);
  if (quantity <= 0) {
    if (index >= 0) items.splice(index, 1);
  } else {
    const previous = index >= 0 ? items[index] : undefined;
    const unitPriceMinor = metadata?.unitPriceMinor ?? previous?.unitPriceMinor ?? null;
    const next: GuestCartItem = {
      skuId,
      quantity,
      name: metadata?.name ?? previous?.name ?? "Fresh grocery",
      availability: unitPriceMinor === null ? "PRICE_UNAVAILABLE" : "AVAILABLE",
      unitPriceMinor,
      currency: metadata?.currency ?? previous?.currency ?? "PHP",
      lineTotalMinor: unitPriceMinor === null ? null : quantity * unitPriceMinor,
    };
    if (index >= 0) items[index] = next;
    else items.push(next);
  }
  const view: CartView = {
    id: "guest-cart",
    version: 1,
    items,
    totalMinor: items.reduce((total, item) => total + (item.lineTotalMinor ?? 0), 0),
    currency: items[0]?.currency ?? "PHP",
    checkoutBlocked: items.some((item) => item.availability !== "AVAILABLE"),
    blockingReasons: [
      ...(items.some((item) => item.availability === "UNAVAILABLE")
        ? (["ITEM_UNAVAILABLE"] as const)
        : []),
      ...(items.some((item) => item.availability === "PRICE_UNAVAILABLE")
        ? (["PRICE_UNAVAILABLE"] as const)
        : []),
    ],
  };
  if (typeof window !== "undefined") {
    if (items.length)
      window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify({ version: 1, items }));
    else window.localStorage.removeItem(GUEST_CART_KEY);
  }
  rememberCart(view);
  return view;
}

export function clearGuestCart(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(GUEST_CART_KEY);
  if (cachedCartView?.id === "guest-cart") cachedCartView = null;
}

export function quantityForSku(view: CartView, skuId: string): number {
  return view.items.find((item) => item.skuId === skuId)?.quantity ?? 0;
}

async function postCartQuantity(
  skuId: string,
  quantity: number,
  metadata?: CartItemMetadata,
): Promise<AddToCartResult> {
  let serverView = cachedCartView?.id !== "guest-cart" ? cachedCartView : null;
  if (!serverView) {
    try {
      const response = await fetch("/api/commerce/cart");
      const loaded = (await response.json()) as CartRouteResult;
      if (loaded.ok && loaded.value) serverView = loaded.value;
      else if (loaded.error?.code === "UNAUTHENTICATED") {
        const view = rememberGuestItem(skuId, quantity, metadata);
        return { ok: true, count: cartCountFromView(view), requiresSignIn: true };
      } else {
        return {
          ok: false,
          reason: "error",
          message: loaded.error?.message ?? "Unable to load the cart.",
        };
      }
    } catch {
      return { ok: false, reason: "error", message: "The cart could not be reached." };
    }
  }
  let result: CartRouteResult;
  try {
    const response = await fetch("/api/commerce/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cartId: serverView.id,
        skuId,
        quantity,
        expectedVersion: serverView.version,
        idempotencyKey: crypto.randomUUID(),
      }),
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
  if (code === "UNAUTHENTICATED") {
    const view = rememberGuestItem(skuId, quantity, metadata);
    return { ok: true, count: cartCountFromView(view), requiresSignIn: true };
  }
  return {
    ok: false,
    reason: code === "UNAUTHENTICATED" ? "unauthenticated" : "error",
    message: result.error?.message ?? "Unable to update the cart.",
  };
}

async function mergeGuestCart(serverView: CartView, guestView: CartView): Promise<CartView | null> {
  let merged = serverView;
  for (const item of guestView.items) {
    try {
      const response = await fetch("/api/commerce/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cartId: merged.id,
          skuId: item.skuId,
          quantity: item.quantity,
          expectedVersion: merged.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = (await response.json()) as CartRouteResult;
      if (!result.ok || !result.value) return null;
      merged = result.value;
    } catch {
      return null;
    }
  }
  clearGuestCart();
  return merged;
}

/** Increment a SKU's cart quantity by one. */
export function addToCart(
  skuId: string,
  quantity: number,
  metadata?: CartItemMetadata,
): Promise<AddToCartResult> {
  return postCartQuantity(skuId, quantity, metadata);
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
      const guest = guestCartView();
      const merged = guest ? await mergeGuestCart(result.value, guest) : result.value;
      const next = merged ?? result.value;
      rememberCart(next);
      return next;
    }
    const guest = guestCartView();
    if (guest) {
      rememberCart(guest);
      return guest;
    }
    cachedCartView = null;
    return null;
  } catch {
    const guest = guestCartView();
    if (guest) {
      rememberCart(guest);
      return guest;
    }
    return null;
  }
}

export function announceToast(toast: StorefrontToast): void {
  window.dispatchEvent(new CustomEvent(STOREFRONT_TOAST_EVENT, { detail: toast }));
}
