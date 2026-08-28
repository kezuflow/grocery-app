import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Read-only preview: never claims usage or mutates state. */
export async function POST(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
  const body = (await request.json().catch(() => null)) as { subtotalMinor?: unknown } | null;
  if (!Number.isInteger(body?.subtotalMinor)) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An integer subtotalMinor is required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).previewAdminPromotion({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    promotionId,
    subtotalMinor: body!.subtotalMinor as number,
  });
  return Response.json(result);
}
