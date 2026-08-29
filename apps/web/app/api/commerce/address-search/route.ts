import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";

const querySchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    latitude: z.coerce.number().finite().min(-90).max(90).optional(),
    longitude: z.coerce.number().finite().min(-180).max(180).optional(),
  })
  .superRefine((value, context) => {
    if ((value.latitude === undefined) !== (value.longitude === undefined))
      context.addIssue({
        code: "custom",
        message: "latitude and longitude must be provided together",
        path: [value.latitude === undefined ? "latitude" : "longitude"],
      });
  });

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    query: url.searchParams.get("query") ?? "",
    latitude: url.searchParams.get("latitude") ?? undefined,
    longitude: url.searchParams.get("longitude") ?? undefined,
  });
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
      { status: 400, headers: { "x-request-id": requestId } },
    );

  const { query, latitude, longitude } = parsed.data;
  const result = await coreClient(env.CORE).searchAddressCandidates({
    requestId,
    query,
    ...(latitude !== undefined && longitude !== undefined
      ? { proximity: { latitude, longitude } }
      : {}),
  });
  const responseRequestId = result.ok ? result.requestId : result.error.requestId;
  return Response.json(result, {
    status: result.ok ? 200 : result.error.code.startsWith("GEOCODER_") ? 503 : 400,
    headers: { "x-request-id": responseRequestId },
  });
}
