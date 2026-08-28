import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Read one order issue through the Core read model. */
export async function GET(request: Request, context: { params: Promise<{ "issue-id": string }> }) {
  const { "issue-id": issueId } = await context.params;
  const result = await coreClient(env.CORE).getAdminOrderIssue({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    issueId,
  });
  return Response.json(result);
}
