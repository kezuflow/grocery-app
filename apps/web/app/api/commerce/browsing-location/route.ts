import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { BROWSING_CONTEXT_COOKIE } from "@/lib/storefront/browsing-location";

const PRIVATE_NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
} as const;

const coordinateSchema = z.object({
  coordinate: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const parsed = coordinateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Choose a valid map location.",
          requestId,
        },
      },
      {
        status: 400,
        headers: { ...PRIVATE_NO_STORE_HEADERS, "x-request-id": requestId },
      },
    );

  const result = await coreClient(env.CORE).confirmBrowsingLocation({
    requestId,
    coordinate: parsed.data.coordinate,
  });
  const responseRequestId = result.ok ? result.requestId : result.error.requestId;
  const token = result.ok ? result.value.browsingContextToken : null;
  const publicResult = result.ok
    ? { ...result, value: { ...result.value, browsingContextToken: null } }
    : result;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const contextCookie = token
    ? `${BROWSING_CONTEXT_COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure}`
    : `${BROWSING_CONTEXT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  return Response.json(publicResult, {
    status: result.ok ? 200 : result.error.code.startsWith("GEOCODER_") ? 503 : 400,
    headers: {
      ...PRIVATE_NO_STORE_HEADERS,
      "x-request-id": responseRequestId,
      "set-cookie": contextCookie,
    },
  });
}
