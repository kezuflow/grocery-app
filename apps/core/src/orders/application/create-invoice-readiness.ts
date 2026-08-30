import { invoiceReadiness, type InvoiceFinancialFacts } from "../domain/invoice-readiness";

export function createInvoiceReadinessStatement(
  database: D1Database,
  input: {
    id: string;
    orderId: string;
    paymentIntentId: string;
    financial: InvoiceFinancialFacts;
    buyerSnapshot: Record<string, unknown>;
    now: number;
  },
) {
  const decision = invoiceReadiness({
    financial: input.financial,
    sellerSnapshot: null,
    buyerSnapshot: input.buyerSnapshot,
    taxPolicyVersion: null,
    taxClassifications: null,
  });
  if (!decision.ok) throw new Error(decision.code);
  return database
    .prepare(
      `INSERT INTO order_invoice_readiness
     (id,order_id,payment_id,payment_intent_id,status,buyer_snapshot_json,financial_snapshot_json,
      blocked_reason,created_at,updated_at,version)
     SELECT ?,?,pa.id,?,?,?, ?,?,?,?,1 FROM payment_attempt pa
     WHERE pa.payment_intent_id=? AND pa.status='SUCCEEDED' ORDER BY pa.created_at LIMIT 1`,
    )
    .bind(
      input.id,
      input.orderId,
      input.paymentIntentId,
      decision.status,
      JSON.stringify(input.buyerSnapshot),
      JSON.stringify(input.financial),
      decision.blockedReason,
      input.now,
      input.now,
      input.paymentIntentId,
    );
}
