import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";

const bodySchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(200),
});
export async function POST(request: Request) {
  const context = webRequestContext(request);
  const parsed = await readBoundedJson(request, bodySchema, { maxBytes: 4096 });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, context.requestId);
  return jsonWithRequestId(
    await coreClient(env.CORE).selectCartLocation({
      ...parsed.value,
      requestId: context.requestId,
      headers: context.coreHeaders,
    }),
    context.requestId,
  );
}
