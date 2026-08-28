import { requireExpectedVersion, requireIdempotencyKey } from "@/lib/core-client/commands";

export function invalid(message: string): Response {
  return Response.json(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId: crypto.randomUUID() },
    },
    { status: 400 },
  );
}

export function requiredLocation(params: URLSearchParams): string | Response {
  const locationId = params.get("locationId")?.trim();
  return locationId ? locationId : invalid("locationId is required");
}

export function optionalLimit(params: URLSearchParams): number | undefined | Response {
  const raw = params.get("limit");
  if (!raw?.trim()) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 100
    ? value
    : invalid("limit must be an integer between 1 and 100");
}

export function commandMeta(request: Request, input: Record<string, unknown>) {
  return {
    idempotencyKey: requireIdempotencyKey(request, input.idempotencyKey),
    expectedVersion: requireExpectedVersion(input.expectedVersion),
  };
}
