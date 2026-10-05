import type { ProviderEvent } from "../ports/provider-event";

/** Protected provider evidence never rewrites a paid customer charge. */
export function providerEvidenceStatements(
  database: D1Database,
  dispatchId: string,
  observedAt: number,
  evidence: ProviderEvent["evidence"] = [],
) {
  const statements = evidence.flatMap((item) => [
    database
      .prepare(
        `INSERT INTO delivery_provider_evidence(dispatch_id,kind,observed_at,evidence_json) VALUES (?,?,?,?) ON CONFLICT(dispatch_id,kind) DO UPDATE SET observed_at=excluded.observed_at,evidence_json=excluded.evidence_json WHERE excluded.observed_at>delivery_provider_evidence.observed_at`,
      )
      .bind(dispatchId, item.kind, observedAt, JSON.stringify(item.value)),
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_evidence WHERE dispatch_id=? AND kind=? AND (observed_at>? OR (observed_at=? AND evidence_json=?)))`,
      )
      .bind(dispatchId, item.kind, observedAt, observedAt, JSON.stringify(item.value)),
  ]);
  // Current PH integration uses PHP's two decimal places. Unsupported costs
  // remain in the protected inbox rather than changing the cost projection.
  // The parser supplies exact integer minor units; SQL never parses provider decimals.
  statements.push(
    database
      .prepare(
        `UPDATE delivery_provider_dispatch SET final_payable_minor=json_extract(evidence_json,'$.amountMinor'),courier_variance_minor=json_extract(evidence_json,'$.amountMinor')-customer_delivery_charge_minor FROM delivery_provider_evidence WHERE delivery_provider_dispatch.id=? AND dispatch_id=delivery_provider_dispatch.id AND kind='COST' AND delivery_currency='PHP' AND json_extract(evidence_json,'$.currency')='PHP' AND customer_delivery_charge_minor IS NOT NULL AND json_type(evidence_json,'$.amountMinor')='integer'`,
      )
      .bind(dispatchId),
  );
  statements.push(
    database
      .prepare(`UPDATE delivery_provider_dispatch SET missing_delivery_proof=CASE WHEN provider_status='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM delivery_provider_evidence evidence,json_each(evidence.evidence_json) proof WHERE evidence.dispatch_id=delivery_provider_dispatch.id AND evidence.kind='DELIVERY_PROOF'
    AND (upper(json_extract(proof.value,'$.status')) IN ('DELIVERED','SIGNED') OR json_array_length(json_extract(proof.value,'$.imageUrls'))>0)
    ) AND NOT EXISTS (
    SELECT 1 FROM delivery_provider_evidence evidence,json_each(evidence.evidence_json) code WHERE evidence.dispatch_id=delivery_provider_dispatch.id AND evidence.kind='DELIVERY_CODE' AND upper(json_extract(code.value,'$.status'))='VERIFIED'
    ) THEN 1 ELSE 0 END WHERE id=?`)
      .bind(dispatchId),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
  );
  return statements;
}
