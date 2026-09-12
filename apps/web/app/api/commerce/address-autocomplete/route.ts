import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
const schema = z.object({
  query: z.string().trim().min(2).max(200),
  proximity: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .optional(),
  sessionToken: z.string().uuid(),
});
const headers = { "cache-control": "private, no-store, max-age=0", pragma: "no-cache" };
export function GET() {
  return Response.json({ ok: false }, { status: 405, headers: { ...headers, Allow: "POST" } });
}
export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Check the address search input.", requestId },
      },
      { status: 400, headers },
    );
  const result = await coreClient(env.CORE).autocompleteAddress({ ...parsed.data, requestId });
  return Response.json(result, {
    status: result.ok ? 200 : result.error.code.startsWith("GEOCODER_") ? 503 : 400,
    headers,
  });
}
