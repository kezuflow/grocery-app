import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function parseLimit(params: URLSearchParams, requestId: string): number | undefined | Response {
  const raw = params.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: requestId,
        },
      },
      { status: 400 },
    );
  }
  return parsed;
}

/** Thin same-origin BFF adapter for the role list. Transport only. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params, webRequestId(request));
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listAdminRoles({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

/** Role creation: closed canonical capability codes are enforced in Core. */
async function POSTHandler(request: Request) {
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
    code?: unknown;
    name?: unknown;
    description?: unknown;
    capabilityCodes?: unknown;
  } | null;
  if (
    typeof body?.code !== "string" ||
    typeof body?.name !== "string" ||
    typeof body?.description !== "string" ||
    !Array.isArray(body?.capabilityCodes)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "code, name, description, and capabilityCodes are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminRole({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    code: body.code,
    name: body.name,
    description: body.description,
    capabilityCodes: body.capabilityCodes as import("@freshmarkets/contracts").Capability[],
    idempotencyKey,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.roles.get", GETHandler);

export const POST = observeAdminRoute("admin.roles.post", POSTHandler);
