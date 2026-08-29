import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Apply a closed issue action. Transport only; Core owns transitions. */
export async function POST(request: Request, context: { params: Promise<{ "issue-id": string }> }) {
  const { "issue-id": issueId } = await context.params;
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
    action?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;
  const actions = ["CLAIM", "BEGIN_INVESTIGATION", "RESOLVE", "ESCALATE"] as const;
  const action =
    typeof body?.action === "string" ? actions.find((value) => value === body.action) : undefined;
  if (!action || typeof body?.reason !== "string" || !Number.isInteger(body?.expectedVersion)) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "action, reason, and integer expectedVersion are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).applyAdminOrderIssueAction({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    issueId,
    action,
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return Response.json(result);
}
