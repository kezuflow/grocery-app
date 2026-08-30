import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import {
  dispatchContextSchema,
  orderedDeliveriesSchema,
  validationFailure,
} from "../delivery-map-route-utils";

const bodySchema = z.union([
  dispatchContextSchema.options[0].extend({ orderedDeliveries: orderedDeliveriesSchema }).strict(),
  dispatchContextSchema.options[1].extend({ orderedDeliveries: orderedDeliveriesSchema }).strict(),
]);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationFailure(requestId, "Invalid route preview request");

  return Response.json(
    await coreClient(env.CORE).previewDeliveryBatchRoute({
      requestId,
      headers: requestHeaders(request),
      ...parsed.data,
    }),
  );
}
