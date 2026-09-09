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
  cartId: z.string().min(1).max(200),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
  items: z
    .array(
      z.object({
        skuId: z.string().min(1).max(200),
        quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1)
    .max(100),
});
export async function POST(request: Request) {
  const context = webRequestContext(request);
  const parsed = await readBoundedJson(request, bodySchema, { maxBytes: 16 * 1024 });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, context.requestId);
  return jsonWithRequestId(
    await coreClient(env.CORE).mergeGuestCart({
      ...parsed.value,
      requestId: context.requestId,
      headers: context.coreHeaders,
    }),
    context.requestId,
  );
}
