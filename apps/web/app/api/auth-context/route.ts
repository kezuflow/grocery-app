import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";

export async function GET(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const result = await coreClient(env.CORE).getApplicationContext({
    headers,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  });
  return Response.json(result, {
    headers: { "x-request-id": request.headers.get("x-request-id") ?? "" },
  });
}
