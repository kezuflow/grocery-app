import { env } from "cloudflare:workers";
import type { ServiceabilityRequest } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";

const serviceabilityBodySchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  marketCode: z.string().trim().min(1).optional(),
  addressComponents: z.record(z.string(), z.string()).optional(),
  previousResolution: z
    .object({
      serviceAreaCode: z.string(),
      serviceAreaPolygonVersion: z.number().int().nonnegative(),
      deliveryZoneCode: z.string().nullable(),
      deliveryZonePolygonVersion: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const parsed = serviceabilityBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Latitude and longitude numbers are required.",
          requestId,
        },
      },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
  const input: Omit<ServiceabilityRequest, "requestId"> = parsed.data;
  const result = await coreClient(env.CORE).resolveServiceability({
    ...input,
    requestId,
  });
  const responseRequestId = result.ok ? result.requestId : result.error.requestId;
  return Response.json(result, { headers: { "x-request-id": responseRequestId } });
}
