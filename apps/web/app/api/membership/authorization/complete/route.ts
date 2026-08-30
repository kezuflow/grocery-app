import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { z } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";
const AUTHORIZATION_COMMAND_MAX_BYTES = 16 * 1024;
const bodySchema = z.object({ authorizationId: z.string().trim().min(1) });

// Confirms the pending recurring authorization from a verified provider
// lookup after the customer returns from instrument collection.
export async function POST(request: Request): Promise<Response> {
  const context = webRequestContext(request);
  const body = await readBoundedJson(request, bodySchema, {
    maxBytes: AUTHORIZATION_COMMAND_MAX_BYTES,
  });
  if (!body.ok) return boundedBodyErrorResponse(body.error, context.requestId);
  const result = await coreClient(env.CORE).completeRecurringAuthorization({
    requestId: context.requestId,
    headers: context.coreHeaders,
    authorizationId: body.value.authorizationId,
  });
  return jsonWithRequestId(result, context.requestId);
}
