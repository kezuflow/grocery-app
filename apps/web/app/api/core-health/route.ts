import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { getCoreHealth } from "@/lib/core-client/health";

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const health = await getCoreHealth(env.CORE as unknown as CoreServiceBinding, requestId);

  return Response.json(health, {
    headers: { "x-request-id": requestId },
  });
}
