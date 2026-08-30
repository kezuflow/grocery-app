import { env } from "cloudflare:workers";
import type { EligibleRiderPage, EligibleRiderView, RpcResult } from "@freshmarkets/contracts";
import { identifierSchema, idempotencyKeySchema, z } from "@freshmarkets/validation";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import {
  dispatchContextSchema,
  hasOnlyQueryKeys,
  orderedDeliveriesSchema,
  parseQueryContext,
  validationFailure,
} from "../delivery-map/delivery-map-route-utils";

const GET_QUERY_KEYS = new Set(["locationId", "fulfillmentMode", "cycleId"]);

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
  const params = new URL(request.url).searchParams;
  const context = parseQueryContext(params);
  if (!hasOnlyQueryKeys(params, GET_QUERY_KEYS) || !context) {
    return validationFailure(requestId, "Invalid eligible Riders request");
  }

  const core = coreClient(env.CORE);
  const baseRequest = { requestId, headers: requestHeaders(request), ...context };
  const riders: EligibleRiderView[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const result = await core.getEligibleRiders({ ...baseRequest, ...(cursor ? { cursor } : {}) });
    if (!result.ok) return Response.json(result);
    const page = result.value;
    if (
      !isEligibleRiderPage(page) ||
      page.complete !== (page.nextCursor === null) ||
      (page.nextCursor !== null && seenCursors.has(page.nextCursor)) ||
      (page.nextCursor !== null && page.riders.length === 0)
    ) {
      return Response.json(paginationFailure(requestId));
    }
    riders.push(...page.riders);
    if (page.nextCursor === null) {
      return Response.json({ ok: true, value: riders, requestId } satisfies RpcResult<
        ReadonlyArray<EligibleRiderView>
      >);
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function isEligibleRiderPage(value: unknown): value is EligibleRiderPage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Partial<EligibleRiderPage>;
  return (
    Array.isArray(page.riders) &&
    typeof page.complete === "boolean" &&
    (page.nextCursor === null ||
      (typeof page.nextCursor === "string" &&
        page.nextCursor.length > 0 &&
        page.nextCursor.length <= 1_024))
  );
}

function paginationFailure(requestId: string): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Eligible Rider pagination could not be completed safely",
      requestId,
    },
  };
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
  const parsedIdempotencyKey = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!parsedIdempotencyKey.success) {
    return validationFailure(requestId, "Invalid idempotency key");
  }
  const { idempotencyKey: _bodyKey, ...command } = parsed.data;

  return Response.json(
    await coreClient(env.CORE).createAndAssignDeliveryBatch({
      requestId,
      headers: requestHeaders(request),
      ...command,
      idempotencyKey: parsedIdempotencyKey.data,
    }),
  );
}
