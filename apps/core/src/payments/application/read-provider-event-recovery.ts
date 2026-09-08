import type { AdminReconciliationCaseView } from "@freshmarkets/contracts";
import { parseNormalizedProviderObservation } from "./redrive-provider-inbox";

/** Private normalized evidence is validated here and never returned to Admin. */
export async function readProviderEventRecovery(
  database: D1Database,
  caseIds: ReadonlyArray<string>,
  canManage: boolean,
) {
  const result = new Map<
    string,
    NonNullable<AdminReconciliationCaseView["providerEventRecovery"]>
  >();
  if (!caseIds.length) return result;
  const rows = await database
    .prepare(`SELECT c.id case_id,c.status case_status,i.provider,i.provider_event_id,i.payload_hash,i.processing_status,i.last_error_code,i.attempts,i.lease_owner,i.lease_expires_at,i.signature_verified_at,i.normalized_observation_json
    FROM payment_reconciliation_case c JOIN payment_provider_event_inbox i
    ON i.provider=CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.provider') END
    AND i.provider_event_id=CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.providerEventId') END
    WHERE c.id IN (${caseIds.map(() => "?").join(",")}) AND CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.reason') END='INBOX_REDRIVE_EXHAUSTED'`)
    .bind(...caseIds)
    .all<{
      case_id: string;
      case_status: string;
      provider: string;
      provider_event_id: string;
      payload_hash: string;
      processing_status: string;
      last_error_code: string | null;
      attempts: number;
      lease_owner: string | null;
      lease_expires_at: number | null;
      signature_verified_at: number | null;
      normalized_observation_json: string | null;
    }>();
  const now = Date.now();
  for (const row of rows.results) {
    const event = row.normalized_observation_json
      ? parseNormalizedProviderObservation(row.normalized_observation_json)
      : null;
    const valid =
      row.signature_verified_at !== null &&
      event !== null &&
      ["payment", "refund"].includes(event.kind) &&
      event.provider === row.provider &&
      event.providerEventId === row.provider_event_id &&
      event.payloadHash === row.payload_hash;
    const unavailableReason = !canManage
      ? "Global payment permission is required."
      : row.case_status !== "OPEN"
        ? "Case is already resolved."
        : !valid
          ? "Stored provider evidence requires review."
          : row.processing_status !== "RECONCILIATION_REQUIRED" ||
              row.last_error_code !== "INBOX_REDRIVE_EXHAUSTED"
            ? "Event recovery is already queued or applied."
            : row.lease_owner !== null &&
                row.lease_expires_at !== null &&
                row.lease_expires_at > now
              ? "Event recovery is currently leased."
              : null;
    result.set(row.case_id, {
      canRetry: unavailableReason === null,
      attempts: row.attempts,
      state: row.processing_status,
      unavailableReason,
    });
  }
  return result;
}
