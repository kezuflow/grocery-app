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
const ELIGIBLE_RIDER_MAX_CORE_PAGE_CALLS = 10;
const ELIGIBLE_RIDER_MAX_PAGE_ITEMS = 200;
const ELIGIBLE_RIDER_MAX_ITEMS = 2_000;
const ELIGIBLE_RIDER_ENTRY_WORK_UNITS = 8;
const ELIGIBLE_RIDER_MAX_VALIDATION_WORK_UNITS = 16_100;

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
  const seenRiderIds = new Set<string>();
  let cursor: string | undefined;
  let lastRiderId: string | null = null;
  let projectionRevision: string | null = null;
  let totalCount: number | null = null;
  let validationWorkUnits = 0;
  for (let call = 0; call < ELIGIBLE_RIDER_MAX_CORE_PAGE_CALLS; call += 1) {
    const result = await core.getEligibleRiders({ ...baseRequest, ...(cursor ? { cursor } : {}) });
    if (!result.ok) return Response.json(result);
    const page = result.value;
    if (
      !isEligibleRiderPage(page) ||
      page.complete !== (page.nextCursor === null) ||
      page.riders.length > ELIGIBLE_RIDER_MAX_PAGE_ITEMS ||
      page.totalCount > ELIGIBLE_RIDER_MAX_ITEMS ||
      (page.nextCursor !== null && seenCursors.has(page.nextCursor)) ||
      (page.nextCursor !== null && page.riders.length === 0)
    ) {
      return Response.json(paginationFailure(requestId));
    }
    validationWorkUnits += page.riders.length * ELIGIBLE_RIDER_ENTRY_WORK_UNITS + 1;
    if (validationWorkUnits > ELIGIBLE_RIDER_MAX_VALIDATION_WORK_UNITS) {
      return Response.json(paginationFailure(requestId));
    }
    projectionRevision ??= page.projectionRevision;
    totalCount ??= page.totalCount;
    if (
      page.projectionRevision !== projectionRevision ||
      page.totalCount !== totalCount ||
      riders.length + page.riders.length > totalCount ||
      riders.length + page.riders.length > ELIGIBLE_RIDER_MAX_ITEMS
    ) {
      return Response.json(paginationFailure(requestId));
    }
    for (const rider of page.riders) {
      if (
        seenRiderIds.has(rider.riderId) ||
        (lastRiderId !== null && compareText(rider.riderId, lastRiderId) <= 0)
      ) {
        return Response.json(paginationFailure(requestId));
      }
      seenRiderIds.add(rider.riderId);
      lastRiderId = rider.riderId;
    }
    riders.push(...page.riders);
    if (page.nextCursor === null) {
      if (riders.length !== totalCount) return Response.json(paginationFailure(requestId));
      riders.sort(
        (left, right) =>
          compareText(left.displayName, right.displayName) ||
          compareText(left.riderId, right.riderId),
      );
      return Response.json({ ok: true, value: riders, requestId } satisfies RpcResult<
        ReadonlyArray<EligibleRiderView>
      >);
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return Response.json(paginationFailure(requestId));
}

function isEligibleRiderPage(value: unknown): value is EligibleRiderPage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["riders", "nextCursor", "complete", "projectionRevision", "totalCount"])
  )
    return false;
  const page = value as Partial<EligibleRiderPage>;
  return (
    Array.isArray(page.riders) &&
    page.riders.every(isEligibleRider) &&
    typeof page.complete === "boolean" &&
    (page.nextCursor === null ||
      (typeof page.nextCursor === "string" &&
        page.nextCursor.length > 0 &&
        page.nextCursor.length <= 1_024 &&
        /^[A-Za-z0-9_-]+$/.test(page.nextCursor))) &&
    typeof page.projectionRevision === "string" &&
    /^[a-f0-9]{64}$/.test(page.projectionRevision) &&
    isNonNegativeInteger(page.totalCount)
  );
}

function isEligibleRider(value: unknown): value is EligibleRiderView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["riderId", "displayName", "openBatchCount", "openDeliveryCount"]) &&
    isIdentifier(value.riderId) &&
    isDisplayName(value.displayName) &&
    isNonNegativeInteger(value.openBatchCount) &&
    isNonNegativeInteger(value.openDeliveryCount)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value
  );
}

function isDisplayName(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
