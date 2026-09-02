import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";

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

  const result = await coreClient(env.CORE).reverseAddressCandidate({
    requestId,
    coordinate: parsed.data.coordinate,
  });
  const responseRequestId = result.ok ? result.requestId : result.error.requestId;
  return Response.json(result, {
    status: result.ok ? 200 : result.error.code.startsWith("GEOCODER_") ? 503 : 400,
    headers: { ...PRIVATE_NO_STORE_HEADERS, "x-request-id": responseRequestId },
  });
}
