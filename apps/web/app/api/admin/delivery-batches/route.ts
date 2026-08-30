import { env } from "cloudflare:workers";
import { identifierSchema, idempotencyKeySchema, z } from "@freshmarkets/validation";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import {
  dispatchContextSchema,
  orderedDeliveriesSchema,
  parseQueryContext,
  validationFailure,
} from "../delivery-map/delivery-map-route-utils";

const commandSchema = z.union([
  dispatchContextSchema.options[0]
    .extend({
      riderId: identifierSchema,
      orderedDeliveries: orderedDeliveriesSchema,
      idempotencyKey: idempotencyKeySchema.optional(),
    })
    .strict(),
  dispatchContextSchema.options[1]
    .extend({
      riderId: identifierSchema,
      orderedDeliveries: orderedDeliveriesSchema,
      idempotencyKey: idempotencyKeySchema.optional(),
    })
    .strict(),
]);

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const context = parseQueryContext(new URL(request.url).searchParams);
  if (!context) return validationFailure(requestId, "Invalid eligible Riders request");

  return Response.json(
    await coreClient(env.CORE).getEligibleRiders({
      requestId,
      headers: requestHeaders(request),
      ...context,
    }),
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationFailure(requestId, "Invalid delivery batch request");

  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(request, parsed.data.idempotencyKey);
  } catch (error) {
    return validationFailure(requestId, (error as Error).message);
  }
  const { idempotencyKey: _bodyKey, ...command } = parsed.data;

  return Response.json(
    await coreClient(env.CORE).createAndAssignDeliveryBatch({
      requestId,
      headers: requestHeaders(request),
      ...command,
      idempotencyKey,
    }),
  );
}
