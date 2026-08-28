import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireExpectedVersion, requireIdempotencyKey } from "@/lib/core-client/commands";
import { commandMeta, invalid, optionalLimit, requiredLocation } from "../operations-route-utils";

const bodySchema = z.object({
  locationId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  action: z.enum(["DISPATCH", "DELIVER", "FAIL"]),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
const legacySchema = z.object({
  orderId: z.string().trim().min(1),
  command: z.enum(["fulfillment", "delivery"]),
  action: z.enum(["START", "PACK", "SHORTAGE", "DISPATCH", "DELIVER", "FAIL"]),
});

/** Scoped delivery dispatch queue and explicit lifecycle command adapter. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = requiredLocation(params);
  if (locationId instanceof Response) return locationId;
  const limit = optionalLimit(params);
  if (limit instanceof Response) return limit;
  return Response.json(
    await coreClient(env.CORE).listDeliveryOperations({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      locationId,
      cycleId: params.get("cycleId") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit,
    }),
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const legacy = legacySchema.safeParse(body);
  if (legacy.success) {
    const expectedVersion = (() => {
      try {
        const raw = new URL(request.url).searchParams.get("v");
        return requireExpectedVersion(raw === null ? undefined : Number(raw));
      } catch {
        return null;
      }
    })();
    if (expectedVersion === null) return invalid("EXPECTED_VERSION_REQUIRED");
    try {
      const common = {
        requestId: crypto.randomUUID(),
        headers: requestHeaders(request),
        idempotencyKey: requireIdempotencyKey(request),
        expectedVersion,
      };
      if (
        legacy.data.command === "fulfillment" &&
        ["START", "PACK", "SHORTAGE"].includes(legacy.data.action)
      ) {
        return Response.json(
          await coreClient(env.CORE).advanceFulfillment({
            ...common,
            orderId: legacy.data.orderId,
            action: legacy.data.action as "START" | "PACK" | "SHORTAGE",
          }),
        );
      }
      if (
        legacy.data.command === "delivery" &&
        ["DISPATCH", "DELIVER", "FAIL"].includes(legacy.data.action)
      ) {
        return Response.json(
          await coreClient(env.CORE).advanceDelivery({
            ...common,
            orderId: legacy.data.orderId,
            action: legacy.data.action as "DISPATCH" | "DELIVER" | "FAIL",
          }),
        );
      }
      return invalid("Invalid legacy delivery command");
    } catch (error) {
      return invalid((error as Error).message);
    }
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success)
    return invalid("locationId, orderId, action, and current expectedVersion are required");
  try {
    const meta = commandMeta(request, parsed.data);
    return Response.json(
      await coreClient(env.CORE).advanceAdminDelivery({
        requestId: crypto.randomUUID(),
        headers: requestHeaders(request),
        ...parsed.data,
        ...meta,
      }),
    );
  } catch (error) {
    return invalid((error as Error).message);
  }
}
