import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one staff identity. Transport only. */
async function GETHandler(request: Request, context: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = await context.params;
  const result = await coreClient(env.CORE).getAdminStaff({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    staffId,
  });
  return adminJson(result);
}

async function PATCHHandler(
  request: Request,
  context: { params: Promise<{ "staff-id": string }> },
) {
  const { "staff-id": staffId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  const body = (await request.json().catch(() => null)) as {
    displayName?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    idempotencyKey.trim() === "" ||
    typeof body?.displayName !== "string" ||
    body.displayName.trim() === "" ||
    !Number.isInteger(body.expectedVersion)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "displayName, integer expectedVersion, and idempotency-key are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).updateAdminStaff({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    staffId,
    displayName: body.displayName.trim(),
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.staff.by_staff_id.get", GETHandler);

export const PATCH = observeAdminRoute("admin.staff.by_staff_id.patch", PATCHHandler);
