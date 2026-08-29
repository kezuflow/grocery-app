import { env } from "cloudflare:workers";
import { analyticsMetricCategories, metricDefinitionStatuses } from "@freshmarkets/contracts";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid, parseScope } from "../route-utils";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const category = params.get("category")?.trim() || undefined;
  const status = params.get("status")?.trim() || undefined;
  const scope = parseScope(params);
  if (scope instanceof Response) return scope;
  if (category && !(analyticsMetricCategories as readonly string[]).includes(category)) {
    return invalid("category is not supported");
  }
  if (status && !(metricDefinitionStatuses as readonly string[]).includes(status)) {
    return invalid("status is not supported");
  }
  return Response.json(
    await coreClient(env.CORE).listMetricDefinitions({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      category: category as (typeof analyticsMetricCategories)[number] | undefined,
      status: status as (typeof metricDefinitionStatuses)[number] | undefined,
      scope,
    }),
  );
}
