import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import {
  parsePositiveVersion,
  parseQueryContext,
  parseRequiredIdentifier,
  validationFailure,
} from "../delivery-map-route-utils";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const params = new URL(request.url).searchParams;
  const context = parseQueryContext(params);
  const jobId = parseRequiredIdentifier(params, "jobId");
  const expectedVersion = parsePositiveVersion(params, "expectedVersion");
  if (!context || !jobId || expectedVersion === null) {
    return validationFailure(requestId, "Invalid delivery map detail request");
  }

  return Response.json(
    await coreClient(env.CORE).getDeliveryMapDetail({
      requestId,
      headers: requestHeaders(request),
      ...context,
      jobId,
      expectedVersion,
    }),
  );
}
