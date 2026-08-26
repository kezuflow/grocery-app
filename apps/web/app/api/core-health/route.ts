import { env } from "cloudflare:workers";
import { getCoreHealth } from "@/lib/core-client/health";
import { coreClient } from "@/lib/core-client/core";

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const health = await getCoreHealth(coreClient(env.CORE), requestId);

  return Response.json(health, {
    headers: { "x-request-id": requestId },
  });
}
