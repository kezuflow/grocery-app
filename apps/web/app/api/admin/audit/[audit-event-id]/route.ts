import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Thin same-origin BFF adapter for one Audit event. Scope checks and
 * sanitization happen in Core; this route only forwards the path id.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ "audit-event-id": string }> },
) {
  const { "audit-event-id": auditEventId } = await context.params;
  const result = await coreClient(env.CORE).getAdminAuditEvent({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    auditEventId,
  });
  return Response.json(result);
}
