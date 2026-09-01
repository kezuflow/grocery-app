import type { AdminSelectedScope } from "@freshmarkets/contracts";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid, parseScope } from "../analytics/route-utils";

/** One same-origin adapter for the Core-owned Admin first-render composition. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const timezone = params.get("timezone")?.trim() ?? "";
  if (!timezone) return invalid(request, "An explicit timezone is required");

  let selectedScope: AdminSelectedScope | undefined;
  if (params.has("scopeKind")) {
    const parsed = parseScope(request, params);
    if (parsed instanceof Response) return parsed;
    selectedScope = parsed;
  }

  return adminJson(
    await coreClient(env.CORE).getAdminBootstrap({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      timezone,
      ...(selectedScope ? { selectedScope } : {}),
    }),
  );
}

export const GET = observeAdminRoute("admin.bootstrap.get", GETHandler);
