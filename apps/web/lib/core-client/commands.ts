/**
 * Command-boundary helpers for Web routes. One logical user action carries one
 * stable idempotency key created in the browser and reused across retries;
 * routes never substitute a fresh server-generated key. Lifecycle commands
 * against concurrently mutated aggregates always carry an expected version.
 */
export function requireIdempotencyKey(request: Request, bodyKey?: unknown): string {
  const headerKey = request.headers.get("idempotency-key")?.trim();
  if (
    headerKey &&
    typeof bodyKey === "string" &&
    bodyKey.trim() !== "" &&
    headerKey !== bodyKey.trim()
  ) {
    throw new Error("IDEMPOTENCY_KEY_MISMATCH");
  }
  if (headerKey) return headerKey;
  if (typeof bodyKey === "string" && bodyKey.trim() !== "") return bodyKey.trim();
  throw new Error("IDEMPOTENCY_KEY_REQUIRED");
}

export function requireExpectedVersion(value: unknown): number {
  if (value === undefined || value === null) throw new Error("EXPECTED_VERSION_REQUIRED");
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("EXPECTED_VERSION_INVALID");
  }
  return value;
}
