import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid, requiredLocation } from "../operations-route-utils";
import { requireIdempotencyKey } from "@/lib/core-client/commands";

const schema = z.object({
  locationId: z.string().trim().min(1),
  fulfillmentMode: z.enum(["INSTANT", "SCHEDULED"]),
  cadence: z.enum(["WEEKLY"]).nullable().optional(),
  promiseMinutes: z.number().int().positive().nullable().optional(),
  maxConcurrentInstantOrders: z.number().int().positive().nullable().optional(),
  expectedVersion: z.number().int().nonnegative().nullable(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export async function GET(request: Request) {
  const locationId = requiredLocation(new URL(request.url).searchParams);
  if (locationId instanceof Response) return locationId;
  return Response.json(
    await coreClient(env.CORE).getFulfillmentMode({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      locationId,
    }),
  );
}
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("valid fulfillment mode configuration is required");
  try {
    return Response.json(
      await coreClient(env.CORE).activateFulfillmentMode({
        requestId: crypto.randomUUID(),
        headers: requestHeaders(request),
        ...parsed.data,
        idempotencyKey: requireIdempotencyKey(request, parsed.data.idempotencyKey),
      }),
    );
  } catch (error) {
    return invalid((error as Error).message);
  }
}
