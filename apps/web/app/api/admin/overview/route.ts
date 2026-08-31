import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid, parseScope } from "../analytics/route-utils";

/** Thin same-origin adapter for the Core-owned operational overview. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const selectedScope = parseScope(params);
  if (selectedScope instanceof Response) return selectedScope;
  const timezone = params.get("timezone")?.trim() ?? "";
  if (!timezone) return invalid("An explicit timezone is required");
  return Response.json(
    await coreClient(env.CORE).getAdminOverview({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      selectedScope,
      timezone,
    }),
  );
}
