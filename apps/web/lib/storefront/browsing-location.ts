import type { Coordinate } from "@freshmarkets/contracts";

export const BROWSING_LOCATION_COOKIE = "freshmarkets_browse_point_v2";
export const BROWSING_CONTEXT_COOKIE = "freshmarkets_browse_context_v1";
export const DELIVERY_LOCATION_REQUEST_EVENT = "fm:choose-delivery-location";
export const DELIVERY_SELECTION_STORAGE_KEY = "freshmarkets.delivery-location.v3";

export type DeliveryLocationSelection = {
  displayAddress: string;
  coordinate: Coordinate;
  /** Browser hint only; Core reauthorizes this identity on checkout reads. */
  savedAddressId: string | null;
};

export function readDeliveryLocationSelection(): DeliveryLocationSelection | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(DELIVERY_SELECTION_STORAGE_KEY) ?? "null",
    ) as Partial<DeliveryLocationSelection> | null;
    if (
      !value ||
      typeof value.displayAddress !== "string" ||
      !value.coordinate ||
      !Number.isFinite(value.coordinate.latitude) ||
      !Number.isFinite(value.coordinate.longitude)
    )
      return null;
    return {
      displayAddress: value.displayAddress,
      coordinate: value.coordinate,
      savedAddressId: typeof value.savedAddressId === "string" ? value.savedAddressId : null,
    };
  } catch {
    return null;
  }
}

export function rememberDeliveryLocationSelection(selection: DeliveryLocationSelection): void {
  if (typeof globalThis.localStorage === "undefined") return;
  globalThis.localStorage.setItem(DELIVERY_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  rememberBrowsingPoint(selection.coordinate);
}

/** Session replacement keeps the public pin but discards private address identity. */
export function clearSavedDeliverySelection(): void {
  const selection = readDeliveryLocationSelection();
  if (selection?.savedAddressId)
    rememberDeliveryLocationSelection({ ...selection, savedAddressId: null });
}

/** Remember coordinates, never a client-asserted fulfillment-site authority. */
export function parseBrowsingPoint(value: string | undefined): Coordinate | null {
  if (!value || value.length > 200) return null;
  try {
    const point = JSON.parse(decodeURIComponent(value)) as Coordinate;
    return point &&
      typeof point.latitude === "number" &&
      Number.isFinite(point.latitude) &&
      Math.abs(point.latitude) <= 90 &&
      typeof point.longitude === "number" &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.longitude) <= 180
      ? { latitude: point.latitude, longitude: point.longitude }
      : null;
  } catch {
    return null;
  }
}
export function browsingPointFromCookies(header: string): Coordinate | null {
  return parseBrowsingPoint(
    header
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${BROWSING_LOCATION_COOKIE}=`))
      ?.slice(BROWSING_LOCATION_COOKIE.length + 1),
  );
}
export function rememberBrowsingPoint(point: Coordinate): void {
  document.cookie = `${BROWSING_LOCATION_COOKIE}=${encodeURIComponent(JSON.stringify(point))}; Path=/; Max-Age=2592000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
}
