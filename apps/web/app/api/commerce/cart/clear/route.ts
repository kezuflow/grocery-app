import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";

const CLEAR_CART_MAX_BYTES = 8 * 1024;
const clearCartBodySchema = z.object({
  cartId: z.string().trim().min(1),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8),
});

export async function POST(request: Request) {
  const context = webRequestContext(request);
  const parsed = await readBoundedJson(request, clearCartBodySchema, {
    maxBytes: CLEAR_CART_MAX_BYTES,
  });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, context.requestId);
  return jsonWithRequestId(
    await coreClient(env.CORE).clearCart({
      requestId: context.requestId,
      headers: context.coreHeaders,
      ...parsed.value,
    }),
    context.requestId,
  );
}
