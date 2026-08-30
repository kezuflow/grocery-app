import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";
const CART_COMMAND_MAX_BYTES = 16 * 1024;
const cartBodySchema = z.object({
  cartId: z.string().trim().min(1),
  skuId: z.string().trim().min(1),
  quantity: z.number().int().nonnegative(),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8),
});
export async function GET(request: Request) {
  const context = webRequestContext(request);
  return jsonWithRequestId(
    await coreClient(env.CORE).getCart({
      requestId: context.requestId,
      headers: context.coreHeaders,
    }),
    context.requestId,
  );
}
export async function POST(request: Request) {
  const context = webRequestContext(request);
  const parsed = await readBoundedJson(request, cartBodySchema, {
    maxBytes: CART_COMMAND_MAX_BYTES,
  });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, context.requestId);
  const body = parsed.value;
  return jsonWithRequestId(
    await coreClient(env.CORE).setCartItem({
      requestId: context.requestId,
      headers: context.coreHeaders,
      cartId: body.cartId,
      skuId: body.skuId,
      quantity: body.quantity,
      expectedVersion: body.expectedVersion,
      idempotencyKey: body.idempotencyKey,
    }),
    context.requestId,
  );
}
