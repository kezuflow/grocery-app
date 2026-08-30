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

const schema = z.object({ outcome: z.enum(["SUCCEEDED", "FAILED", "EXPIRED"]) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ "provider-reference": string }> },
) {
  if (env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test")
    return new Response("Not Found", { status: 404 });

  const meta = webRequestContext(request);
  const parsed = await readBoundedJson(request, schema, { maxBytes: 1024 });
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
  const { "provider-reference": providerReference } = await context.params;
  return jsonWithRequestId(
    await coreClient(env.CORE).simulateMockProviderEvent({
      requestId: meta.requestId,
      headers: meta.coreHeaders,
      providerReference,
      outcome: parsed.value.outcome,
      idempotencyKey,
    }),
    meta.requestId,
  );
}
