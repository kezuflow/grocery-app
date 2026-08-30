import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";

const schema = z.object({
  addressId: z.string().trim().min(1).max(128),
  addressVersion: z.number().int().positive(),
  cartId: z.string().trim().min(1).max(128),
  cartVersion: z.number().int().positive(),
});
export async function POST(request: Request) {
  const meta = webRequestContext(request);
  const parsed = await readBoundedJson(request, schema, { maxBytes: 8 * 1024 });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, meta.requestId);
  return jsonWithRequestId(
    await coreClient(env.CORE).listFulfillmentOptions({
      requestId: meta.requestId,
      headers: meta.coreHeaders,
      ...parsed.value,
    }),
    meta.requestId,
  );
}
