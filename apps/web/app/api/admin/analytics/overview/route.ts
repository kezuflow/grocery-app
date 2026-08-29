import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid, parseDimensions, parseScope, parseWindow } from "../route-utils";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const window = parseWindow(params);
  if (window instanceof Response) return window;
  const dimensions = parseDimensions(params);
  if (dimensions instanceof Response) return dimensions;
  const scope = parseScope(params);
  if (scope instanceof Response) return scope;
  try {
    return Response.json(
      await coreClient(env.CORE).getAnalyticsOverview({
        requestId: crypto.randomUUID(),
        headers: requestHeaders(request),
        window,
        dimensions,
        scope,
      }),
    );
  } catch (error) {
    return invalid((error as Error).message || "Invalid Analytics request");
  }
}
