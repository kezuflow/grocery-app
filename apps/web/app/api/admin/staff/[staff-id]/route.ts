import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one staff identity. Transport only. */
export async function GET(request: Request, context: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = await context.params;
  const result = await coreClient(env.CORE).getAdminStaff({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    staffId,
  });
  return Response.json(result);
}
