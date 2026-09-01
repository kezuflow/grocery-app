import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Thin same-origin BFF adapter for one Audit event. Scope checks and
 * sanitization happen in Core; this route only forwards the path id.
 */
async function GETHandler(
  request: Request,
  context: { params: Promise<{ "audit-event-id": string }> },
) {
  const { "audit-event-id": auditEventId } = await context.params;
  const result = await coreClient(env.CORE).getAdminAuditEvent({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    auditEventId,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.audit.by_audit_event_id.get", GETHandler);
