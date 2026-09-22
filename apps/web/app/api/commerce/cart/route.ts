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

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function logCartPost(context: {
  requestId: string;
  result: "success" | "rejected" | "exception";
  parseMs: number;
  rpcMs: number;
  totalMs: number;
}): void {
  // Fixed, non-customer fields only. The request ID correlates Web and Core logs.
  console.log(JSON.stringify({ event: "cart.web.post", ...context }));
}

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
  const startedAt = performance.now();
  const context = webRequestContext(request);
  let parseMs = 0;
  let rpcMs = 0;
  try {
    const parseStartedAt = performance.now();
    const parsed = await readBoundedJson(request, cartBodySchema, {
      maxBytes: CART_COMMAND_MAX_BYTES,
    });
    parseMs = elapsedMs(parseStartedAt);
    if (!parsed.ok) {
      logCartPost({
        requestId: context.requestId,
        result: "rejected",
        parseMs,
        rpcMs,
        totalMs: elapsedMs(startedAt),
      });
      return boundedBodyErrorResponse(parsed.error, context.requestId);
    }
    const body = parsed.value;
    const rpcStartedAt = performance.now();
    const result = await coreClient(env.CORE).setCartItem({
      requestId: context.requestId,
      headers: context.coreHeaders,
      cartId: body.cartId,
      skuId: body.skuId,
      quantity: body.quantity,
      expectedVersion: body.expectedVersion,
      idempotencyKey: body.idempotencyKey,
    });
    rpcMs = elapsedMs(rpcStartedAt);
    const response = jsonWithRequestId(result, context.requestId);
    response.headers.append("server-timing", `cart_rpc;dur=${rpcMs}`);
    const totalMs = elapsedMs(startedAt);
    response.headers.append("server-timing", `cart_web;dur=${totalMs}`);
    logCartPost({
      requestId: context.requestId,
      result: result.ok ? "success" : "rejected",
      parseMs,
      rpcMs,
      totalMs,
    });
    return response;
  } catch (error) {
    logCartPost({
      requestId: context.requestId,
      result: "exception",
      parseMs,
      rpcMs,
      totalMs: elapsedMs(startedAt),
    });
    throw error;
  }
}
