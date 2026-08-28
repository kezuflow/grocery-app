import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function parseLimit(params: URLSearchParams): number | undefined | Response {
  const raw = params.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  return parsed;
}

const PAYMENT_STATUSES = [
  "INITIATED",
  "REQUIRES_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

/** Thin same-origin BFF adapter for the payments list. Transport only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params);
  if (limit instanceof Response) return limit;
  const statusParam = params.get("status");
  const status =
    statusParam !== null && (PAYMENT_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as (typeof PAYMENT_STATUSES)[number])
      : undefined;
  const result = await coreClient(env.CORE).listAdminPayments({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    status,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return Response.json(result);
}
