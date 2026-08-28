import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { commandMeta, invalid, optionalLimit, requiredLocation } from "../operations-route-utils";

const commandSchema = z.object({
  locationId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  action: z.enum(["START", "PACK", "SHORTAGE"]),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
/** Scoped fulfillment queue and explicit transition adapter. Core determines legal actions. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(params);
  if (locationId instanceof Response) return locationId;
  const limit = optionalLimit(params);
  if (limit instanceof Response) return limit;
  return Response.json(
    await coreClient(env.CORE).listFulfillmentQueue({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      locationId,
      cycleId: params.get("cycleId") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit,
    }),
  );
}
export async function POST(request: Request) {
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid("locationId, orderId, action, and current expectedVersion are required");
  try {
    const meta = commandMeta(request, parsed.data);
    return Response.json(
      await coreClient(env.CORE).advanceAdminFulfillment({
        requestId: crypto.randomUUID(),
        headers: requestHeaders(request),
        ...parsed.data,
        ...meta,
      }),
    );
  } catch (error) {
    return invalid((error as Error).message);
  }
}
