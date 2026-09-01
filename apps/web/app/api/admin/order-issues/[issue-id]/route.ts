import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Read one order issue through the Core read model. */
async function GETHandler(request: Request, context: { params: Promise<{ "issue-id": string }> }) {
  const { "issue-id": issueId } = await context.params;
  const result = await coreClient(env.CORE).getAdminOrderIssue({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    issueId,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.order_issues.by_issue_id.get", GETHandler);
