import type { Coordinate } from "@freshmarkets/contracts";

export const BROWSING_LOCATION_COOKIE = "freshmarkets_browse_point";
export const DELIVERY_LOCATION_REQUEST_EVENT = "fm:choose-delivery-location";

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
  document.cookie = `${BROWSING_LOCATION_COOKIE}=${encodeURIComponent(JSON.stringify(point))}; Path=/; Max-Age=2592000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}
