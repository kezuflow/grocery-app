export type IdempotencyRecord = {
  requestHash: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  resultType: string;
  resultReference: string | null;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export async function requestHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function findIdempotencyRecord(
  database: D1Database,
  scope: string,
  key: string,
): Promise<IdempotencyRecord | null> {
  const row = await database
    .prepare(
      "SELECT request_hash, status, result_type, result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(scope, key)
    .first<{
      request_hash: string;
      status: IdempotencyRecord["status"];
      result_type: string;
      result_reference: string | null;
    }>();
  return row
    ? {
        requestHash: row.request_hash,
        status: row.status,
        resultType: row.result_type,
        resultReference: row.result_reference,
      }
    : null;
}

export type ClaimedCommandIdempotency =
  | { hash: string; existing: null; claimed: true }
  | { hash: string; existing: IdempotencyRecord | null; claimed: false };

/**
 * Atomically claim a command idempotency key: insert-or-reclaim PROCESSING
 * ownership for `scope`+`key`, or report the existing record so callers can
 * replay a succeeded result or reject hash mismatches/reentry.
 */
export async function claimCommandIdempotency(
  database: D1Database,
  now: () => number,
  scope: string,
  key: string,
  payload: unknown,
): Promise<ClaimedCommandIdempotency> {
  const hash = await requestHash(payload);
  const existing = await findIdempotencyRecord(database, scope, key);
  if (existing) {
    if (existing.requestHash !== hash) return { hash, existing, claimed: false };
    if (existing.status === "FAILED") {
      const reclaimed = await database
        .prepare(
          "UPDATE idempotency_records SET status='PROCESSING', result_reference=NULL, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='FAILED'",
        )
        .bind(now(), scope, key, hash)
        .run();
      if ((reclaimed.meta?.changes ?? 0) === 1) return { hash, existing: null, claimed: true };
      return { hash, existing: await findIdempotencyRecord(database, scope, key), claimed: false };
    }
    return { hash, existing, claimed: false };
  }
  const result = await database
    .prepare(
      "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'PROCESSING', ?, ?)",
    )
    .bind(scope, key, hash, scope, now(), now())
    .run();
  if ((result.meta?.changes ?? 0) !== 1) {
    return { hash, existing: await findIdempotencyRecord(database, scope, key), claimed: false };
  }
  return { hash, existing: null, claimed: true };
}
