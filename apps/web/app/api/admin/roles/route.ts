import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function parseLimit(params: URLSearchParams): number | undefined | Response {
  const raw = params.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  return parsed;
}

/** Thin same-origin BFF adapter for the role list. Transport only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params);
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listAdminRoles({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return Response.json(result);
}

/** Role creation: closed canonical capability codes are enforced in Core. */
export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "") {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An idempotency-key header is required",
          requestId: crypto.randomUUID(),
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
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "code, name, description, and capabilityCodes are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminRole({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    code: body.code,
    name: body.name,
    description: body.description,
    capabilityCodes: body.capabilityCodes as import("@freshmarkets/contracts").Capability[],
    idempotencyKey,
  });
  return Response.json(result);
}
