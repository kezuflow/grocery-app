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
