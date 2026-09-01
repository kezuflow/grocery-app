import { requireExpectedVersion, requireIdempotencyKey } from "@/lib/core-client/commands";
import { adminJson } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";

export function invalid(request: Request, message: string): Response {
  return adminJson(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId: webRequestId(request) },
    },
    { status: 400 },
  );
}

export function requiredLocation(request: Request, params: URLSearchParams): string | Response {
  const locationId = params.get("locationId")?.trim();
  return locationId ? locationId : invalid(request, "locationId is required");
}

export function optionalLimit(
  request: Request,
  params: URLSearchParams,
): number | undefined | Response {
  const raw = params.get("limit");
  if (!raw?.trim()) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 100
    ? value
    : invalid(request, "limit must be an integer between 1 and 100");
}

export function commandMeta(request: Request, input: Record<string, unknown>) {
  return {
    idempotencyKey: requireIdempotencyKey(request, input.idempotencyKey),
    expectedVersion: requireExpectedVersion(input.expectedVersion),
  };
}
