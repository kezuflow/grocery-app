import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Resolve an open reconciliation case. Transport only; Core authorizes. */
export async function POST(request: Request, context: { params: Promise<{ "case-id": string }> }) {
  const { "case-id": caseId } = await context.params;
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
  const result = await coreClient(env.CORE).resolveAdminReconciliationCase({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    caseId,
    reason: body.reason,
    idempotencyKey,
  });
  return Response.json(result);
}
