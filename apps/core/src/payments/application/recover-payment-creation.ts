import { auditEventStatement } from "../../audit/application/append-audit-event";
import { createPaymentRepository } from "../infrastructure/d1/payment-repository";
import type { PaymentProvider } from "../ports/payment-provider";

type CreationResult = Extract<Awaited<ReturnType<PaymentProvider["createPayment"]>>, { ok: true }>;
type CreationIdentity = {
  intentId: string;
  provider: string;
  purpose: string;
  subjectType: string;
  subjectId: string;
  customerId: string;
  amountMinor: number;
  currency: string;
};
/** Persist only the adapter's bounded creation facts. Private continuation values never enter audit/logs. */
export async function recordPaymentCreation(
  database: D1Database,
  input: CreationIdentity,
  result: CreationResult,
  now: number,
): Promise<void> {
  const saved = await database
    .prepare(`INSERT INTO payment_creation_observation(payment_intent_id,provider,provider_reference,purpose,subject_type,subject_id,customer_id,amount_minor,currency,action_type,redirect_url,client_token,expires_at,observed_at)
    SELECT id,?,?,purpose,subject_type,subject_id,customer_id,amount_minor,currency,?,?,?,?,? FROM payment_intent
    WHERE id=? AND purpose=? AND subject_type=? AND subject_id=? AND customer_id=? AND amount_minor=? AND currency=?`)
    .bind(
      input.provider,
      result.providerReference,
      result.actionType,
      result.redirectUrl,
      result.clientToken,
      result.expiresAt,
      now,
      input.intentId,
      input.purpose,
      input.subjectType,
      input.subjectId,
      input.customerId,
      input.amountMinor,
      input.currency,
    )
    .run();
  if (saved.meta.changes !== 1) throw new Error("PAYMENT_CREATION_IDENTITY_CHANGED");
}
/** Adopt a durable creation response under the complete current write guard. Never calls a provider. */
export async function recoverPaymentCreation(
  database: D1Database,
  intentId: string,
  now = Date.now(),
): Promise<boolean> {
  const row = await database
    .prepare(`SELECT receipt.*,payment.version FROM payment_creation_observation receipt JOIN payment_intent payment ON payment.id=receipt.payment_intent_id
    WHERE receipt.payment_intent_id=? AND receipt.applied_at IS NULL AND payment.status='INITIATED'`)
    .bind(intentId)
    .first<{
      payment_intent_id: string;
      provider: string;
      provider_reference: string;
      purpose: string;
      subject_type: string;
      subject_id: string;
      customer_id: string;
      amount_minor: number;
      currency: string;
      action_type: "NONE" | "REDIRECT" | "SDK";
      redirect_url: string | null;
      client_token: string | null;
      expires_at: number | null;
      observed_at: number;
      version: number;
    }>();
  if (!row) return creationApplied(database, intentId);
  const repository = createPaymentRepository(database);
  const state = row.action_type === "NONE" ? "PROCESSING" : "REQUIRES_ACTION";
  const key = `payment-creation:${intentId}`;
  const statements: D1PreparedStatement[] = [
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (
      SELECT 1 FROM payment_intent p JOIN payment_creation_observation r ON r.payment_intent_id=p.id
      WHERE p.id=? AND p.version=? AND p.status='INITIATED' AND r.applied_at IS NULL
      AND p.purpose=r.purpose AND p.subject_type=r.subject_type AND p.subject_id=r.subject_id
      AND p.customer_id=r.customer_id AND p.amount_minor=r.amount_minor AND p.currency=r.currency)
      OR EXISTS (SELECT 1 FROM payment_attempt WHERE payment_intent_id=?)`)
      .bind(intentId, row.version, intentId),
    repository.updateIntentStatusCas({
      intentId,
      expectedVersion: row.version,
      fromStatus: "INITIATED",
      toStatus: state,
      now,
    }),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    repository.recordAttempt({
      attemptId: crypto.randomUUID(),
      intentId,
      customerId: row.customer_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      status: state,
      provider: row.provider,
      providerReference: row.provider_reference,
      now,
    }),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
  ];
  if (
    row.action_type !== "NONE" &&
    row.expires_at !== null &&
    row.expires_at > now &&
    ((row.action_type === "REDIRECT" && row.redirect_url) ||
      (row.action_type === "SDK" && row.client_token))
  ) {
    statements.push(
      repository.recordProviderActionStatement({
        paymentIntentId: intentId,
        provider: row.provider,
        providerReference: row.provider_reference,
        actionType: row.action_type,
        redirectUrl: row.redirect_url,
        clientToken: row.client_token,
        expiresAt: row.expires_at,
        now,
      }),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    );
  }
  statements.push(
    auditEventStatement(database, {
      actorUserId: null,
      action: "PAYMENT.CREATION_APPLIED",
      resourceType: "payment_intent",
      resourceId: intentId,
      reason: "Persisted provider creation evidence adopted",
      idempotencyKey: key,
      correlationId: key,
      occurredAt: now,
    }),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.CREATION_APPLIED' AND idempotency_key=?)",
      )
      .bind(intentId, key),
    database
      .prepare(
        "UPDATE payment_creation_observation SET applied_at=? WHERE payment_intent_id=? AND applied_at IS NULL",
      )
      .bind(now, intentId),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
  );
  try {
    await database.batch(statements);
  } catch (error) {
    if (await creationApplied(database, intentId)) return true;
    throw error;
  }
  return true;
}

async function creationApplied(database: D1Database, intentId: string): Promise<boolean> {
  return !!(await database
    .prepare(`SELECT 1 FROM payment_creation_observation r JOIN payment_intent p ON p.id=r.payment_intent_id
   JOIN payment_attempt a ON a.payment_intent_id=p.id AND a.provider=r.provider AND a.provider_reference=r.provider_reference AND a.amount_minor=r.amount_minor AND a.currency=r.currency
   WHERE r.payment_intent_id=? AND r.applied_at IS NOT NULL AND p.status!='INITIATED'
   AND EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=r.payment_intent_id AND action='PAYMENT.CREATION_APPLIED' AND idempotency_key='payment-creation:'||r.payment_intent_id)`)
    .bind(intentId)
    .first());
}
