import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function parseLimit(params: URLSearchParams, requestId: string): number | undefined | Response {
  const raw = params.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: requestId,
        },
      },
      { status: 400 },
    );
  }
  return parsed;
}

/** Thin same-origin BFF adapter for the product list. Transport only. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params, webRequestId(request));
  if (limit instanceof Response) return limit;
  const status = params.get("status");
  if (status !== null && status !== "active" && status !== "inactive") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "status must be active or inactive",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const scopeKind = params.get("scopeKind");
  const marketId = params.get("marketId")?.trim() ?? "";
  const locationId = params.get("locationId")?.trim() ?? "";
  if (
    scopeKind !== "GLOBAL" &&
    !(scopeKind === "LOCATION" && marketId.length > 0 && locationId.length > 0)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An explicit GLOBAL or LOCATION Product scope is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).listAdminProducts({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    ...(scopeKind === "LOCATION"
      ? { scopeKind: "LOCATION" as const, marketId, locationId }
      : { scopeKind: "GLOBAL" as const }),
    query: params.get("query") ?? undefined,
    status: status ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

/** Whitelisted Product creation adapter; Core remains authoritative for validation and writes. */
async function POSTHandler(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const customerDetails = body?.customerDetails;
  if (
    !idempotencyKey ||
    typeof body?.categoryId !== "string" ||
    typeof body.slug !== "string" ||
    typeof body.name !== "string" ||
    !(body.description === null || typeof body.description === "string") ||
    !Array.isArray(customerDetails) ||
    typeof body.inventoryBaseUnitId !== "string" ||
    !customerDetails.every(
      (detail) =>
        typeof detail === "object" &&
        detail !== null &&
        typeof (detail as Record<string, unknown>).label === "string" &&
        typeof (detail as Record<string, unknown>).value === "string" &&
        Number.isInteger((detail as Record<string, unknown>).sortOrder),
    )
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "Valid Product fields and an idempotency-key are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  return adminJson(
    await coreClient(env.CORE).createAdminProduct({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      categoryId: body.categoryId,
      slug: body.slug,
      name: body.name,
      description: body.description,
      customerDetails: customerDetails.map((detail) => {
        const record = detail as Record<string, unknown>;
        return {
          label: record.label as string,
          value: record.value as string,
          sortOrder: record.sortOrder as number,
        };
      }),
      inventoryBaseUnitId: body.inventoryBaseUnitId,
      idempotencyKey,
    }),
  );
}

export const GET = observeAdminRoute("admin.catalog.products.get", GETHandler);

export const POST = observeAdminRoute("admin.catalog.products.post", POSTHandler);
