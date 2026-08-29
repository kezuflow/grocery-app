import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";

const PRIVATE_NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
} as const;

const querySchema = z.object({
  query: z.string().trim().min(1).max(200),
  proximity: z
    .object({
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    })
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  return Response.json(
    {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Address search requires a private request body.",
        requestId,
      },
    },
    {
      status: 405,
      headers: { ...PRIVATE_NO_STORE_HEADERS, Allow: "POST", "x-request-id": requestId },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const parsed = querySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Enter an address to search.",
          requestId,
        },
      },
      {
        status: 400,
        headers: { ...PRIVATE_NO_STORE_HEADERS, "x-request-id": requestId },
      },
    );

  const { query, proximity } = parsed.data;
  const result = await coreClient(env.CORE).searchAddressCandidates({
    requestId,
    query,
    ...(proximity ? { proximity } : {}),
  });
  const responseRequestId = result.ok ? result.requestId : result.error.requestId;
  return Response.json(result, {
    status: result.ok ? 200 : result.error.code.startsWith("GEOCODER_") ? 503 : 400,
    headers: { ...PRIVATE_NO_STORE_HEADERS, "x-request-id": responseRequestId },
  });
}
