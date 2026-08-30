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

const bodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  timing: z.enum(["IMMEDIATE", "PERIOD_END"]),
  reason: z.string().trim().min(1).max(500).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const context = webRequestContext(request);
  const body = await readBoundedJson(request, bodySchema, { maxBytes: 16 * 1024 });
  if (!body.ok) return boundedBodyErrorResponse(body.error, context.requestId);
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
          requestId: context.requestId,
        },
      },
      context.requestId,
      { status: 400 },
    );
  }
  return jsonWithRequestId(
    await coreClient(env.CORE).cancelSubscription({
      requestId: context.requestId,
      headers: context.coreHeaders,
      expectedVersion: body.value.expectedVersion,
      timing: body.value.timing,
      reason: body.value.reason,
      idempotencyKey,
    }),
    context.requestId,
  );
}
