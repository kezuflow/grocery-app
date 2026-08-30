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

const bodySchema = z.object({ expectedVersion: z.number().int().positive() });

export async function POST(request: Request, context: { params: Promise<{ "quote-id": string }> }) {
  const requestContext = webRequestContext(request);
  const parsed = await readBoundedJson(request, bodySchema, { maxBytes: 8 * 1024 });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, requestContext.requestId);
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
          requestId: requestContext.requestId,
        },
      },
      requestContext.requestId,
      { status: 400 },
    );
  }
  const { "quote-id": quoteId } = await context.params;
  return jsonWithRequestId(
    await coreClient(env.CORE).abandonCheckoutAttempt({
      requestId: requestContext.requestId,
      headers: requestContext.coreHeaders,
      quoteId,
      expectedVersion: parsed.value.expectedVersion,
      idempotencyKey,
    }),
    requestContext.requestId,
  );
}
