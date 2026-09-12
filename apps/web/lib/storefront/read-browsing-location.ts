import { cookies } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "../core-client/core";
import {
  BROWSING_CONTEXT_COOKIE,
  BROWSING_LOCATION_COOKIE,
  browsingPointFromCookies,
  parseBrowsingPoint,
} from "./browsing-location";

export type CatalogLocationContext = {
  browsingContextToken?: string;
  /** One-release bridge for coordinate cookies created before signed contexts existed. */
  locationId?: string;
};

/** Forward the opaque Core-signed read context without trusting or decoding it in Web. */
export async function readBrowsingLocation(cookieHeader?: string): Promise<CatalogLocationContext> {
  const cookieStore = cookieHeader === undefined ? await cookies() : null;
  const value = cookieStore
    ? cookieStore.get(BROWSING_CONTEXT_COOKIE)?.value
    : (cookieHeader ?? "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${BROWSING_CONTEXT_COOKIE}=`))
        ?.slice(BROWSING_CONTEXT_COOKIE.length + 1);
  if (value && value.length <= 2048) return { browsingContextToken: value };
  const point = cookieStore
    ? parseBrowsingPoint(cookieStore.get(BROWSING_LOCATION_COOKIE)?.value)
    : browsingPointFromCookies(cookieHeader ?? "");
  if (!point) return {};
  const legacy = await coreClient(env.CORE).resolveServiceability({
    ...point,
    requestId: crypto.randomUUID(),
  });
  return legacy.ok && legacy.value.serviceable && legacy.value.fulfillmentLocation
    ? { locationId: legacy.value.fulfillmentLocation.id }
    : {};
}
