import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";

const schema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  additions: z
    .array(
      z.object({
        skuId: z.string().trim().min(1).max(128),
        quantity: z.number().int().positive().max(999),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(request: Request, context: { params: Promise<{ "order-id": string }> }) {
  const meta = webRequestContext(request);
  const parsed = await readBoundedJson(request, schema, { maxBytes: 16 * 1024 });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, meta.requestId);
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(request);
  } catch (error) {
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: (error as Error).message,
          requestId: meta.requestId,
        },
      },
      meta.requestId,
      { status: 400 },
    );
  }
  const { "order-id": orderId } = await context.params;
  return jsonWithRequestId(
    await coreClient(env.CORE).createOrderAmendment({
      requestId: meta.requestId,
      headers: meta.coreHeaders,
      orderId,
      ...parsed.value,
      idempotencyKey,
    }),
    meta.requestId,
  );
}
