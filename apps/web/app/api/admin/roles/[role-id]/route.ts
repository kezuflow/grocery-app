import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one role. Transport only. */
async function GETHandler(request: Request, context: { params: Promise<{ "role-id": string }> }) {
  const { "role-id": roleId } = await context.params;
  const result = await coreClient(env.CORE).getAdminRole({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    roleId,
  });
  return adminJson(result);
}

/** Rename or re-describe an ACTIVE role. Transport only; Core authorizes. */
async function PATCHHandler(request: Request, context: { params: Promise<{ "role-id": string }> }) {
  const { "role-id": roleId } = await context.params;
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
    name?: unknown;
    description?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    typeof body?.name !== "string" ||
    typeof body?.description !== "string" ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "name, description, and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).updateAdminRole({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    roleId,
    name: body.name,
    description: body.description,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.roles.by_role_id.get", GETHandler);

export const PATCH = observeAdminRoute("admin.roles.by_role_id.patch", PATCHHandler);
