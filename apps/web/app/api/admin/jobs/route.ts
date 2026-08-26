import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Recent scheduled-job runs. Authorization happens in Core IAM. */
export async function GET(request: Request) {
  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  return Response.json(
    await coreClient(env.CORE).adminScheduledJobRuns({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      ...(Number.isFinite(limit) ? { limit } : {}),
    }),
  );
}
