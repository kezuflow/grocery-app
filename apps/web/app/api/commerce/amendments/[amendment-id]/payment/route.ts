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
  expectedAmendmentVersion: z.number().int().positive(),
  expectedCurrency: z.string().trim().length(3),
  expectedTotalMinor: z.number().int().positive(),
  returnUrl: z.string().url().max(2000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ "amendment-id": string }> },
) {
  const meta = webRequestContext(request);
  const parsed = await readBoundedJson(request, schema, { maxBytes: 8 * 1024 });
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
  const { "amendment-id": amendmentId } = await context.params;
  return jsonWithRequestId(
    await coreClient(env.CORE).createAmendmentPaymentIntent({
      requestId: meta.requestId,
      headers: meta.coreHeaders,
      amendmentId,
      ...parsed.value,
      idempotencyKey,
    }),
    meta.requestId,
  );
}
