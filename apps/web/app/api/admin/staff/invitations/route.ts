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

/** Thin same-origin BFF adapter for the invitation queue. Transport only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params);
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listAdminStaffInvitations({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return Response.json(result);
}

/** Invitation creation: no password input ever reaches this route. */
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
    email?: unknown;
    displayName?: unknown;
  } | null;
  if (typeof body?.email !== "string" || typeof body?.displayName !== "string") {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "email and displayName are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).inviteAdminStaff({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    email: body.email,
    displayName: body.displayName,
    idempotencyKey,
  });
  return Response.json(result);
}
