import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Membership CANCEL through the canonical command. Transport only. */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "subscription-id": string }> },
) {
  const { "subscription-id": subscriptionId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An idempotency-key header is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    reason?: unknown;
    expectedVersion?: unknown;
    timing?: unknown;
  } | null;
  if (typeof body?.reason !== "string" || !Number.isInteger(body?.expectedVersion)) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "reason and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const timing =
    body.timing === "IMMEDIATE" || body.timing === "PERIOD_END" ? body.timing : undefined;
  const result = await coreClient(env.CORE).cancelAdminMembership({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    subscriptionId,
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    timing,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute(
  "admin.memberships.by_subscription_id.cancel.post",
  POSTHandler,
);
