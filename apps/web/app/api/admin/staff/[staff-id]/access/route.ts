import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function validationFailure(message: string) {
  return Response.json(
    {
      ok: false as const,
      error: {
        code: "VALIDATION_FAILED" as const,
        message,
        requestId: crypto.randomUUID(),
      },
    },
    { status: 400 },
  );
}

/** Activate or suspend a staff identity. Transport only; Core authorizes. */
export async function POST(request: Request, context: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "")
    return validationFailure("An idempotency-key header is required");
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    (body?.action !== "ACTIVATE" && body?.action !== "SUSPEND") ||
    typeof body?.reason !== "string" ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return validationFailure("action, reason, and integer expectedVersion are required");
  }
  const result = await coreClient(env.CORE).changeAdminStaffAccess({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    staffId,
    action: body.action as "ACTIVATE" | "SUSPEND",
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return Response.json(result);
}
