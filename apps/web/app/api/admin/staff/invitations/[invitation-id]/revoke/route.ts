import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

export async function POST(
  request: Request,
  context: { params: Promise<{ "invitation-id": string }> },
) {
  const { "invitation-id": invitationId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  if (
    idempotencyKey.trim() === "" ||
    typeof body?.reason !== "string" ||
    body.reason.trim() === ""
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "A reason and idempotency-key header are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).revokeAdminStaffInvitation({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    invitationId,
    reason: body.reason.trim(),
    idempotencyKey,
  });
  return Response.json(result);
}
