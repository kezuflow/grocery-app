import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { commandMeta, invalid } from "../../operations-route-utils";
const schema = z.object({
  locationId: z.string().trim().min(1),
  receivingSessionId: z.string().trim().min(1),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid("locationId, receivingSessionId, and current expectedVersion are required");
  try {
    const meta = commandMeta(request, parsed.data);
    return Response.json(
      await coreClient(env.CORE).completeAdminReceiving({
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
