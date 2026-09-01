import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Apply a closed issue action. Transport only; Core owns transitions. */
async function POSTHandler(request: Request, context: { params: Promise<{ "issue-id": string }> }) {
  const { "issue-id": issueId } = await context.params;
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
    action?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;
  const actions = ["CLAIM", "BEGIN_INVESTIGATION", "RESOLVE", "ESCALATE"] as const;
  const action =
    typeof body?.action === "string" ? actions.find((value) => value === body.action) : undefined;
  if (!action || typeof body?.reason !== "string" || !Number.isInteger(body?.expectedVersion)) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "action, reason, and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).applyAdminOrderIssueAction({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    issueId,
    action,
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.order_issues.by_issue_id.actions.post", POSTHandler);
