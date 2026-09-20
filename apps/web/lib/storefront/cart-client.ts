import type {
  CartView,
  CatalogMedia,
  ClearCartResult,
  RpcResult,
  GuestCartMerge,
} from "@freshmarkets/contracts";
import { readJson } from "../http/read-deadline";
import { z } from "@freshmarkets/validation";
import { loadCartForLocation, requestDeliveryLocation } from "./load-cart-for-location";
const cartMediaSchema = z.object({
  src: z.string().regex(/^\/media\/products\/[A-Za-z0-9_-]+\/[1-9]\d*$/),
  alt: z.string().trim().min(1).max(300),
});
function cartMedia(value: unknown): CatalogMedia | null {
  const parsed = cartMediaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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
  | { ok: true; view: CartView; count: number; requiresSignIn?: boolean }
  | { ok: false; reason: "unauthenticated" | "error"; message: string };

export type ClearCartClientResult = AddToCartResult;

export type GuestCartItem = {
  skuId: string;
  quantity: number;
  name: string;
  media?: CatalogMedia | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | "PRICE_UNAVAILABLE";
  unitPriceMinor: number | null;
  currency: string;
  lineTotalMinor: number | null;
};

export type CartItemMetadata = Pick<
  GuestCartItem,
  "name" | "unitPriceMinor" | "currency" | "media"
>;

const GUEST_CART_KEY = "freshmarkets.guest-cart.v1";
const GUEST_MERGE_KEY = "freshmarkets.guest-cart-merge.v1";
let loadError = "";
export function cartLoadError(): string {
  return loadError;
}

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
let cachedCartLoadedAt = 0;
const CART_READ_CACHE_MILLISECONDS = 30_000;

export function cachedCart(): CartView | null {
  return cachedCartView;
}

function rememberCart(view: CartView): void {
  if (activeOperationGeneration !== locationGeneration) return;
  cachedCartView = view;
  cachedCartLoadedAt = Date.now();
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
        media: cartMedia(item.media),
        availability:
          item.availability ?? (item.unitPriceMinor === null ? "PRICE_UNAVAILABLE" : "AVAILABLE"),
        lineTotalMinor: item.unitPriceMinor === null ? null : item.quantity * item.unitPriceMinor,
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
      media: cartMedia(metadata?.media ?? previous?.media),
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
      window.localStorage.setItem(
        GUEST_CART_KEY,
        JSON.stringify({ version: 1, transferId: crypto.randomUUID(), items }),
      );
    else window.localStorage.removeItem(GUEST_CART_KEY);
  }
  rememberCart(view);
  return view;
}

export function clearGuestCart(): void {
  loadError = "";
  if (typeof window !== "undefined") window.localStorage.removeItem(GUEST_CART_KEY);
  cachedCartView = null;
  cachedCartLoadedAt = 0;
  pendingCartItemCommand = null;
}

export function quantityForSku(view: CartView, skuId: string): number {
  return view.items.find((item) => item.skuId === skuId)?.quantity ?? 0;
}

type PendingCartItemCommand = {
  cartId: string;
  skuId: string;
  quantity: number;
  expectedVersion: number;
  idempotencyKey: string;
};
let pendingCartItemCommand: PendingCartItemCommand | null = null;

async function postCartQuantity(
  skuId: string,
  quantity: number,
  metadata?: CartItemMetadata,
): Promise<AddToCartResult> {
  if (window.localStorage.getItem(GUEST_MERGE_KEY)) {
    await loadCart();
    return {
      ok: false,
      reason: "error",
      message: loadError || "Your saved cart was updated. Review its quantities before editing.",
    };
  }
  const guest = guestCartView();
  if ((loadError || cachedCartView?.id === "guest-cart") && guest) {
    const view = rememberGuestItem(skuId, quantity, metadata);
    return { ok: true, view, count: cartCountFromView(view) };
  }
  if (
    pendingCartItemCommand &&
    (pendingCartItemCommand.skuId !== skuId || pendingCartItemCommand.quantity !== quantity)
  )
    return {
      ok: false,
      reason: "error",
      message:
        "A previous cart update is not confirmed yet. Retry that item before making another change.",
    };
  // A hydrated server Cart already has the exact identity and optimistic version
  // required by Core. Core revalidates mutable price, stock, ownership and Cart
  // version at the write boundary, so another Cart + serviceability read here is
  // both redundant and a visible interaction waterfall.
  let serverView = cachedCartView?.id === "guest-cart" ? null : cachedCartView;
  if (!serverView && !pendingCartItemCommand) {
    try {
      const loaded = await loadCartForLocation();
      if (loaded.ok) serverView = loaded.value;
      else if (loaded.error?.code === "UNAUTHENTICATED") {
        const view = rememberGuestItem(skuId, quantity, metadata);
        return { ok: true, view, count: cartCountFromView(view), requiresSignIn: true };
      } else {
        if (loaded.error?.code === "DELIVERY_LOCATION_REQUIRED") requestDeliveryLocation();
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
  if (activeOperationGeneration !== locationGeneration) {
    return {
      ok: false,
      reason: "error",
      message: "Delivery location changed. Review your cart before editing.",
    };
  }
  const command =
    pendingCartItemCommand ??
    ({
      cartId: serverView!.id,
      skuId,
      quantity,
      expectedVersion: serverView!.version,
      idempotencyKey: crypto.randomUUID(),
    } satisfies PendingCartItemCommand);
  pendingCartItemCommand = command;
  let result: CartRouteResult;
  try {
    const response = await fetch("/api/commerce/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    result = (await response.json()) as CartRouteResult;
  } catch {
    return {
      ok: false,
      reason: "error",
      message: "The cart update is not confirmed yet. Retry to reconcile the same request.",
    };
  }
  if (result.ok && result.value) {
    pendingCartItemCommand = null;
    rememberCart(result.value);
    return { ok: true, view: result.value, count: cartCountFromView(result.value) };
  }
  const code = result.error?.code ?? "ERROR";
  if (code !== "CONFLICT") pendingCartItemCommand = null;
  if (code === "UNAUTHENTICATED") {
    const view = rememberGuestItem(skuId, quantity, metadata);
    return { ok: true, view, count: cartCountFromView(view), requiresSignIn: true };
  }
  if (code === "CART_VERSION_CONFLICT" || code === "NOT_FOUND") {
    cachedCartView = null;
    cachedCartLoadedAt = 0;
    try {
      const current = await loadCartForLocation();
      if (current.ok) rememberCart(current.value);
    } catch {
      // The mutation was definitively rejected. The authoritative recovery read
      // remains retryable, and the original failure is still returned below.
    }
  }
  return {
    ok: false,
    reason: code === "UNAUTHENTICATED" ? "unauthenticated" : "error",
    message: result.error?.message ?? "Unable to update the cart.",
  };
}

async function mergeGuestCart(serverView: CartView, guestView: CartView): Promise<CartView> {
  const raw = window.localStorage.getItem(GUEST_CART_KEY);
  if (!raw) {
    const current = await readJson<RpcResult<CartView>>("/api/commerce/cart");
    if (!current.ok) throw new Error(current.error.message);
    return current.value;
  }
  const schema = z.object({
    raw: z.string(),
    body: z.object({
      cartId: z.string(),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: z.string(),
      items: z.array(z.object({ skuId: z.string(), quantity: z.number().int().positive() })),
    }),
  });
  const stored = window.localStorage.getItem(GUEST_MERGE_KEY);
  const pending = stored ? schema.parse(JSON.parse(stored)) : null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const identity = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const command = pending ?? {
    raw,
    body: {
      cartId: serverView.id,
      expectedVersion: serverView.version,
      idempotencyKey: `guest-${identity}`,
      items: guestView.items.map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
    },
  };
  window.localStorage.setItem(GUEST_MERGE_KEY, JSON.stringify(command));
  const result = (await (
    await fetch("/api/commerce/cart/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command.body),
    })
  ).json()) as RpcResult<GuestCartMerge>;
  if (!result.ok) {
    if (result.error.code === "CART_VERSION_CONFLICT" || result.error.code === "NOT_FOUND")
      window.localStorage.removeItem(GUEST_MERGE_KEY);
    throw new Error(result.error.message);
  }
  const current = await readJson<RpcResult<CartView>>("/api/commerce/cart");
  if (!current.ok) throw new Error(current.error.message);
  if (window.localStorage.getItem(GUEST_CART_KEY) !== command.raw) {
    const changed = guestCartView();
    const remaining =
      changed?.items
        .map((item) => ({
          ...item,
          currency: changed.currency,
          quantity: Math.max(
            0,
            item.quantity -
              (command.body.items.find((applied) => applied.skuId === item.skuId)?.quantity ?? 0),
          ),
        }))
        .filter((item) => item.quantity > 0) ?? [];
    window.localStorage.removeItem(GUEST_MERGE_KEY);
    if (remaining.length) {
      window.localStorage.setItem(
        GUEST_CART_KEY,
        JSON.stringify({ version: 1, transferId: crypto.randomUUID(), items: remaining }),
      );
      loadError =
        "Your saved cart changed during sign-in. Retry loading to carry over the remaining items, then review quantities.";
      return { ...current.value, checkoutBlocked: true };
    }
  }
  clearGuestCart();
  window.localStorage.removeItem(GUEST_MERGE_KEY);
  return current.value;
}

/** Increment a SKU's cart quantity by one. */
export function addToCart(
  skuId: string,
  quantity: number,
  metadata?: CartItemMetadata,
): Promise<AddToCartResult> {
  const requestedGeneration = locationGeneration;
  return runCartOperation(async () => {
    if (requestedGeneration !== locationGeneration)
      return {
        ok: false as const,
        reason: "error" as const,
        message: "Delivery location changed. Review your cart before editing.",
      };
    const result = await postCartQuantity(skuId, quantity, metadata);
    return result.ok && activeOperationGeneration !== locationGeneration
      ? { ...result, view: { ...result.view, checkoutBlocked: true } }
      : result;
  }).catch((error: unknown): AddToCartResult => {
    if (error instanceof StaleCartOperationError)
      return {
        ok: false,
        reason: "error",
        message: "Your session or delivery location changed. Review your cart before editing.",
      };
    throw error;
  });
}

type PendingClearCommand = {
  cartId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
let pendingClearCommand: PendingClearCommand | null = null;

/** Clear the complete current Cart through one serialized business command. */
export function clearCart(view: CartView): Promise<ClearCartClientResult> {
  const requestedGeneration = locationGeneration;
  return runCartOperation<ClearCartClientResult>(async () => {
    if (requestedGeneration !== locationGeneration)
      return {
        ok: false as const,
        reason: "error" as const,
        message: "Your session or delivery location changed. Review your cart before clearing.",
      };
    if (view.id === "guest-cart") {
      if (window.localStorage.getItem(GUEST_MERGE_KEY))
        return {
          ok: false as const,
          reason: "error" as const,
          message: "Your saved cart is still being transferred. Retry after it finishes.",
        };
      window.localStorage.removeItem(GUEST_CART_KEY);
      const empty: CartView = {
        ...view,
        items: [],
        totalMinor: 0,
        checkoutBlocked: false,
        blockingReasons: [],
      };
      rememberCart(empty);
      return { ok: true as const, view: empty, count: 0 };
    }
    if (
      pendingClearCommand &&
      (pendingClearCommand.cartId !== view.id ||
        pendingClearCommand.expectedVersion !== view.version)
    )
      return {
        ok: false as const,
        reason: "error" as const,
        message: "A previous clear is still being reconciled. Refresh the cart before retrying.",
      };
    const command =
      pendingClearCommand ??
      ({
        cartId: view.id,
        expectedVersion: view.version,
        idempotencyKey: crypto.randomUUID(),
      } satisfies PendingClearCommand);
    pendingClearCommand = command;
    let result: RpcResult<ClearCartResult>;
    try {
      const response = await fetch("/api/commerce/cart/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      result = (await response.json()) as RpcResult<ClearCartResult>;
    } catch {
      return {
        ok: false as const,
        reason: "error" as const,
        message: "The clear result is not confirmed yet. Retry to reconcile the same request.",
      };
    }
    if (!result.ok) {
      if (result.error.code !== "CONFLICT") pendingClearCommand = null;
      if (result.error.code === "CART_VERSION_CONFLICT" || result.error.code === "NOT_FOUND") {
        try {
          const current = await loadCartForLocation();
          if (current.ok) rememberCart(current.value);
        } catch {
          // The command was definitively rejected; the ordinary Cart read remains retryable.
        }
      }
      return {
        ok: false as const,
        reason: result.error.code === "UNAUTHENTICATED" ? "unauthenticated" : "error",
        message: result.error.message,
      };
    }
    try {
      const current = await readJson<RpcResult<CartView>>("/api/commerce/cart");
      if (!current.ok)
        return {
          ok: false as const,
          reason: "error" as const,
          message:
            "The cart was cleared, but its current view could not be loaded. Retry to refresh.",
        };
      if (activeOperationGeneration !== locationGeneration)
        return {
          ok: false as const,
          reason: "error" as const,
          message: "The cart was cleared. Refresh to load the current session.",
        };
      pendingClearCommand = null;
      rememberCart(current.value);
      return {
        ok: true as const,
        view: current.value,
        count: cartCountFromView(current.value),
      };
    } catch {
      return {
        ok: false as const,
        reason: "error" as const,
        message:
          "The cart was cleared, but its current view could not be loaded. Retry to refresh.",
      };
    }
  }).catch((error: unknown): ClearCartClientResult => {
    if (error instanceof StaleCartOperationError)
      return {
        ok: false,
        reason: "error",
        message: "Your session or delivery location changed. Review your cart before clearing.",
      };
    throw error;
  });
}

/**
 * Load the current cart. Anonymous visitors resolve to null rather than an
 * error so surfaces can render signed-out states without console noise.
 */
// Serialize location recovery, guest transfer and quantity commands. A location
// refresh waits for an uncertain in-flight command instead of racing another one.
let operations: Promise<void> = Promise.resolve();
let locationGeneration = 0;
let activeOperationGeneration = 0;
class StaleCartOperationError extends Error {}
/** Identity changes discard display state without issuing a command as the new user. */
export function resetCartSession(): void {
  locationGeneration++;
  cachedCartView = null;
  cachedCartLoadedAt = 0;
  loadError = "";
  loadingCart = null;
  refreshingCart = null;
  pendingClearCommand = null;
  pendingCartItemCommand = null;
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: { count: 0, view: null } }));
}
function runCartOperation<T>(operation: () => Promise<T>): Promise<T> {
  const generation = locationGeneration;
  const next = operations.then(() => {
    if (generation !== locationGeneration) throw new StaleCartOperationError();
    activeOperationGeneration = locationGeneration;
    return operation();
  });
  operations = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
let refreshingCart: Promise<CartView | null> | null = null;
export function refreshCartForLocation(): Promise<CartView | null> {
  locationGeneration++;
  loadError = "";
  cachedCartView = null;
  cachedCartLoadedAt = 0;
  pendingCartItemCommand = null;
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: { count: 0, view: null } }));
  const refresh = runCartOperation(loadCart).finally(() => {
    if (refreshingCart === refresh) refreshingCart = null;
  });
  refreshingCart = refresh;
  return refresh;
}
let loadingCart: Promise<CartView | null> | null = null;
export function fetchCart(options: { fresh?: boolean } = {}): Promise<CartView | null> {
  if (refreshingCart) return refreshingCart;
  if (
    !options.fresh &&
    cachedCartView &&
    cachedCartView.id !== "guest-cart" &&
    Date.now() - cachedCartLoadedAt < CART_READ_CACHE_MILLISECONDS
  )
    return Promise.resolve(cachedCartView);
  if (!loadingCart)
    loadingCart = runCartOperation(loadCart).finally(() => {
      loadingCart = null;
    });
  return loadingCart;
}
async function loadCart(): Promise<CartView | null> {
  loadError = "";
  try {
    const guest = guestCartView();
    const result = await loadCartForLocation({ createIfMissing: Boolean(guest) });
    if (activeOperationGeneration !== locationGeneration) return null;
    if (result.ok && result.value) {
      const merged = guest ? await mergeGuestCart(result.value, guest) : result.value;
      const next = merged;
      rememberCart(next);
      return activeOperationGeneration === locationGeneration ? next : null;
    }
    if (!result.ok && result.error.code !== "UNAUTHENTICATED") loadError = result.error.message;
    if (guest) {
      const view = loadError
        ? {
            ...guest,
            checkoutBlocked: true,
            items: guest.items.map((item) => ({
              ...item,
              unitPriceMinor: null,
              lineTotalMinor: null,
              availability: "PRICE_UNAVAILABLE" as const,
            })),
          }
        : guest;
      rememberCart(view);
      return view;
    }
    cachedCartView = null;
    return null;
  } catch (error) {
    if (activeOperationGeneration !== locationGeneration) return null;
    loadError =
      error instanceof Error
        ? error.message
        : "Your saved cart could not be loaded. Retry without losing your items.";
    const guest = guestCartView();
    if (guest) {
      const view = {
        ...guest,
        checkoutBlocked: true,
        items: guest.items.map((item) => ({
          ...item,
          unitPriceMinor: null,
          lineTotalMinor: null,
          availability: "PRICE_UNAVAILABLE" as const,
        })),
      };
      rememberCart(view);
      return view;
    }
    return null;
  }
}

export function announceToast(toast: StorefrontToast): void {
  window.dispatchEvent(new CustomEvent(STOREFRONT_TOAST_EVENT, { detail: toast }));
}
