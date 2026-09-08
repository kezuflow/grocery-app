import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
export const GET = observeAdminRoute(
  "admin.transfers.by_transfer_id.get",
  async (request: Request, context: { params: Promise<{ "transfer-id": string }> }) => {
    const { "transfer-id": transferId } = await context.params;
    return adminJson(
      await coreClient(env.CORE).getInventoryTransfer({
        transferId,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
      }),
    );
  },
);
