import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { commandMeta, invalid, optionalLimit, requiredLocation } from "../operations-route-utils";
const schema = z.object({
  locationId: z.string().trim().min(1),
  kind: z.enum(["FULFILLMENT_SHORTAGE", "DELIVERY_FAILED"]),
  action: z.enum(["RETRY_FULFILLMENT", "RETRY_DELIVERY"]),
  orderId: z.string().trim().min(1),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(params);
  if (locationId instanceof Response) return locationId;
  const limit = optionalLimit(params);
  if (limit instanceof Response) return limit;
  return Response.json(
    await coreClient(env.CORE).listOperationalExceptions({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      locationId,
      cursor: params.get("cursor") ?? undefined,
      limit,
    }),
  );
}
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid("exception, reason, and current expectedVersion are required");
  try {
    const meta = commandMeta(request, parsed.data);
    return Response.json(
      await coreClient(env.CORE).resolveAdminOperationalException({
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
