import type { AdminReconciliationCaseView } from "@freshmarkets/contracts";
import { reactionRetryEvidence } from "../infrastructure/d1/reaction-recovery-evidence";
export async function readPaymentReactionRecovery(
  database: D1Database,
  caseIds: ReadonlyArray<string>,
  canManage: boolean,
) {
  const result = new Map<
    string,
    NonNullable<AdminReconciliationCaseView["paymentReactionRecovery"]>
  >();
  if (!caseIds.length) return result;
  const rows = await database
    .prepare(`SELECT c.id,c.status case_status,r.status,r.attempts,r.available_at,p.version,(${reactionRetryEvidence}) eligible
 FROM payment_reconciliation_case c JOIN payment_reaction r ON r.id=CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.reactionId') END AND r.payment_intent_id=c.payment_intent_id
 JOIN payment_intent p ON p.id=r.payment_intent_id WHERE c.category='REACTION_FAILURE' AND c.id IN (${caseIds.map(() => "?").join(",")})`)
    .bind(...caseIds)
    .all<{
      id: string;
      case_status: string;
      status: string;
      attempts: number;
      available_at: number | null;
      version: number;
      eligible: number;
    }>();
  const now = Date.now();
  for (const row of rows.results) {
    const unavailableReason = !canManage
      ? "Global payment permission is required."
      : row.case_status !== "OPEN"
        ? "Case is already resolved."
        : !row.eligible
          ? "Only an exhausted commerce reaction with captured payment and no active refund can be retried."
          : row.available_at !== null && row.available_at > now
            ? "The current recovery lease has not expired."
            : null;
    result.set(row.id, {
      canRetry: unavailableReason === null,
      attempts: row.attempts,
      state: row.status,
      paymentVersion: row.version,
      unavailableReason,
    });
  }
  return result;
}
