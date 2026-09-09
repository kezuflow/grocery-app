import { cookies } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "../core-client/core";
import {
  BROWSING_LOCATION_COOKIE,
  browsingPointFromCookies,
  parseBrowsingPoint,
} from "./browsing-location";

/** Re-resolve remembered coordinates for every server catalog request. */
export async function readBrowsingLocation(cookieHeader?: string): Promise<string | undefined> {
  const point =
    cookieHeader === undefined
      ? parseBrowsingPoint((await cookies()).get(BROWSING_LOCATION_COOKIE)?.value)
      : browsingPointFromCookies(cookieHeader);
  if (!point) return undefined;
  const result = await coreClient(env.CORE).resolveServiceability({
    ...point,
    requestId: crypto.randomUUID(),
  });
  return result.ok && result.value.serviceable ? result.value.fulfillmentLocation?.id : undefined;
}
