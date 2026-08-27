import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Revoke every Better Auth session for the staff user. Transport only. */
export async function POST(request: Request, context: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = await context.params;
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
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  if (typeof body?.reason !== "string" || body.reason.trim() === "") {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "A reason is required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).revokeAdminStaffSessions({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    staffId,
    reason: body.reason,
    idempotencyKey,
  });
  return Response.json(result);
}
