import type {
  AmendmentPaymentIntentRequest,
  PaymentActionView,
  RpcResult,
} from "@freshmarkets/contracts";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { createPayment } from "./create-payment";

export async function createAmendmentPaymentIntent(
  database: D1Database,
  registry: PaymentProviderRegistry,
  providerCode: string,
  command: AmendmentPaymentIntentRequest & { customerId: string },
): Promise<RpcResult<PaymentActionView>> {
  const amendment = await database
    .prepare(
      `SELECT a.id,a.status,a.version,a.currency,a.total_minor AS totalMinor,a.payment_intent_id AS paymentIntentId
       FROM paid_order_amendment a JOIN grocery_order o ON o.id=a.order_id
       WHERE a.id=? AND o.customer_id=?`,
    )
    .bind(command.amendmentId, command.customerId)
    .first<{
      id: string;
      status: string;
      version: number;
      currency: string;
      totalMinor: number;
      paymentIntentId: string | null;
    }>();
  if (!amendment)
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Amendment not found", requestId: command.requestId },
    };
  const replay = await database
    .prepare(
      "SELECT id FROM payment_intent WHERE idempotency_key=? AND purpose='ORDER_AMENDMENT' AND subject_type='paid_order_amendment' AND subject_id=? AND customer_id=?",
    )
    .bind(command.idempotencyKey, amendment.id, command.customerId)
    .first<{ id: string }>();
  const acceptedVersion =
    amendment.version === command.expectedAmendmentVersion ||
    (amendment.status === "COMMITTED" &&
      amendment.version === command.expectedAmendmentVersion + 1);
  if (
    replay &&
    acceptedVersion &&
    amendment.currency === command.expectedCurrency &&
    amendment.totalMinor === command.expectedTotalMinor
  )
    return createPayment(database, registry, {
      purpose: "ORDER_AMENDMENT",
      subjectType: "paid_order_amendment",
      subjectId: amendment.id,
      customerId: command.customerId,
      amountMinor: amendment.totalMinor,
      currency: amendment.currency,
      providerCode,
      returnUrl: command.returnUrl,
      idempotencyKey: command.idempotencyKey,
      requestId: command.requestId,
    });
  if (amendment.status !== "PENDING_PAYMENT")
    return {
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        message: "Amendment is not awaiting payment",
        requestId: command.requestId,
      },
    };
  if (
    amendment.version !== command.expectedAmendmentVersion ||
    amendment.currency !== command.expectedCurrency ||
    amendment.totalMinor !== command.expectedTotalMinor
  )
    return {
      ok: false,
      error: {
        code: "PRICE_CHANGED",
        message: "Amendment total changed; review it again",
        requestId: command.requestId,
      },
    };

  const payment = await createPayment(database, registry, {
    purpose: "ORDER_AMENDMENT",
    subjectType: "paid_order_amendment",
    subjectId: amendment.id,
    customerId: command.customerId,
    amountMinor: amendment.totalMinor,
    currency: amendment.currency,
    providerCode,
    returnUrl: command.returnUrl,
    idempotencyKey: command.idempotencyKey,
    requestId: command.requestId,
  });
  if (!payment.ok) return payment;
  const linked = await database
    .prepare(
      `UPDATE paid_order_amendment SET payment_intent_id=?,updated_at=?
       WHERE id=? AND status='PENDING_PAYMENT' AND version=?
         AND (payment_intent_id IS NULL OR payment_intent_id=?)`,
    )
    .bind(
      payment.value.paymentIntentId,
      Date.now(),
      amendment.id,
      amendment.version,
      payment.value.paymentIntentId,
    )
    .run();
  if ((linked.meta?.changes ?? 0) !== 1) {
    await database
      .prepare(
        `INSERT OR IGNORE INTO finance_exception
         (id,kind,payment_intent_id,order_id,details_json,attempts,last_error_code,status,created_at)
         SELECT ?, 'TRANSIENT_FAILURE', ?, a.order_id, ?, 0, 'AMENDMENT_LINK_FAILED', 'OPEN', ?
         FROM paid_order_amendment a WHERE a.id=?`,
      )
      .bind(
        crypto.randomUUID(),
        payment.value.paymentIntentId,
        JSON.stringify({ amendmentId: amendment.id }),
        Date.now(),
        amendment.id,
      )
      .run();
    return {
      ok: false,
      error: {
        code: "FINANCIAL_OPERATION_REQUIRES_REVIEW",
        message: "Payment started but the amendment needs reconciliation",
        requestId: command.requestId,
      },
    };
  }
  return payment;
}
