import type {
  CartView,
  RpcResult,
  ServiceabilityResult,
  CartLocationSelection,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { browsingPointFromCookies, DELIVERY_LOCATION_REQUEST_EVENT } from "./browsing-location";

const pendingKey = "freshmarkets.cart-location-command.v1";
const commandSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8),
});
type CartResult = RpcResult<CartView>;

/** Keep an uncertain location command for exact replay before accepting a new choice. */
export async function loadCartForLocation(): Promise<CartResult> {
  const point = typeof document === "undefined" ? null : browsingPointFromCookies(document.cookie);
  const missing: CartResult = {
    ok: false,
    error: {
      code: "DELIVERY_LOCATION_REQUIRED",
      message: "Choose your delivery location before adding groceries.",
      requestId: "browser-location",
    },
  };
  if (!point) return missing;
  const resolution = (await (
    await fetch("/api/serviceability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(point),
    })
  ).json()) as RpcResult<ServiceabilityResult>;
  if (!resolution.ok) return resolution;
  const locationId = resolution.value.fulfillmentLocation?.id;
  if (!resolution.value.serviceable || !locationId) return missing;
  let cart = (await (await fetch("/api/commerce/cart")).json()) as CartResult;
  if (!cart.ok && cart.error.code !== "DELIVERY_LOCATION_REQUIRED") return cart;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = window.localStorage.getItem(pendingKey);
    let pending: z.infer<typeof commandSchema> | null = null;
    if (raw) {
      try {
        const parsed = commandSchema.safeParse(JSON.parse(raw));
        if (parsed.success) pending = parsed.data;
      } catch {
        /* A malformed local draft is not an authoritative command. */
      }
    }
    if (!pending && cart.ok && cart.value.locationId === locationId) return cart;
    const command = pending ?? {
      ...point,
      expectedVersion: cart.ok ? cart.value.version : 0,
      idempotencyKey: crypto.randomUUID(),
    };
    window.localStorage.setItem(pendingKey, JSON.stringify(command));
    const selected = (await (
      await fetch("/api/commerce/cart/location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      })
    ).json()) as RpcResult<CartLocationSelection>;
    if (!selected.ok) {
      if (
        [
          "CART_VERSION_CONFLICT",
          "CONFLICT",
          "IDEMPOTENCY_CONFLICT",
          "ADDRESS_UNSERVICEABLE",
        ].includes(selected.error.code)
      )
        window.localStorage.removeItem(pendingKey);
      return selected;
    }
    window.localStorage.removeItem(pendingKey);
    cart = (await (await fetch("/api/commerce/cart")).json()) as CartResult;
    if (!cart.ok) return cart;
    if (cart.value.locationId === locationId) return cart;
  }
  return missing;
}

export function requestDeliveryLocation(): void {
  window.dispatchEvent(new Event(DELIVERY_LOCATION_REQUEST_EVENT));
}
