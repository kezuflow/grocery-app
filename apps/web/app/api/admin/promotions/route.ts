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

/** Thin same-origin BFF adapter for the promotion list. Transport only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params);
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listAdminPromotions({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return Response.json(result);
}

/** Promotion creation: closed benefit set, validated authoritatively in Core. */
export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "") {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An idempotency-key header is required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    typeof body?.code !== "string" ||
    typeof body?.name !== "string" ||
    typeof body?.benefitType !== "string" ||
    !Number.isInteger(body?.minimumMinor) ||
    typeof body?.startsAt !== "string"
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "code, name, benefitType, minimumMinor, and startsAt are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminPromotion({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    code: body.code,
    name: body.name,
    description: typeof body.description === "string" ? body.description : "",
    benefitType: body.benefitType as "ORDER_FIXED_DISCOUNT" | "ORDER_PERCENT_DISCOUNT",
    discountMinor: typeof body.discountMinor === "number" ? body.discountMinor : undefined,
    percent: typeof body.percent === "number" ? body.percent : undefined,
    minimumMinor: body.minimumMinor as number,
    startsAt: body.startsAt,
    endsAt: typeof body.endsAt === "string" ? body.endsAt : null,
    globalUsageLimit: typeof body.globalUsageLimit === "number" ? body.globalUsageLimit : null,
    perCustomerUsageLimit:
      typeof body.perCustomerUsageLimit === "number" ? body.perCustomerUsageLimit : null,
    automatic: body.automatic === true,
    priority: typeof body.priority === "number" ? body.priority : 0,
    idempotencyKey,
  });
  return Response.json(result);
}
