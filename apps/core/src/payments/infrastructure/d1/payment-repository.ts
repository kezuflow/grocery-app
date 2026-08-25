export type PaymentIntentRow = {
  id: string;
  purpose: string;
  subjectType: string;
  subjectId: string;
  customerId: string;
  amountMinor: number;
  currency: string;
  status: string;
  idempotencyKey: string;
  version: number;
};

export type CreateIntentInput = {
  id: string;
  purpose: string;
  subjectType: string;
  subjectId: string;
  customerId: string;
  amountMinor: number;
  currency: string;
  status: string;
  idempotencyKey: string;
};

export function createPaymentRepository(database: D1Database) {
  return {
    async findIntentByIdempotencyKey(idempotencyKey: string): Promise<PaymentIntentRow | null> {
      const row = await database
        .prepare(
          "SELECT id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version FROM payment_intent WHERE idempotency_key=?",
        )
        .bind(idempotencyKey)
        .first<{
          id: string;
          purpose: string;
          subject_type: string;
          subject_id: string;
          customer_id: string;
          amount_minor: number;
          currency: string;
          status: string;
          idempotency_key: string;
          version: number;
        }>();
      return row
        ? {
            id: row.id,
            purpose: row.purpose,
            subjectType: row.subject_type,
            subjectId: row.subject_id,
            customerId: row.customer_id,
            amountMinor: row.amount_minor,
            currency: row.currency,
            status: row.status,
            idempotencyKey: row.idempotency_key,
            version: row.version,
          }
        : null;
    },
    async findIntentById(id: string): Promise<PaymentIntentRow | null> {
      const row = await database
        .prepare(
          "SELECT id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version FROM payment_intent WHERE id=?",
        )
        .bind(id)
        .first<{
          id: string;
          purpose: string;
          subject_type: string;
          subject_id: string;
          customer_id: string;
          amount_minor: number;
          currency: string;
          status: string;
          idempotency_key: string;
          version: number;
        }>();
      return row
        ? {
            id: row.id,
            purpose: row.purpose,
            subjectType: row.subject_type,
            subjectId: row.subject_id,
            customerId: row.customer_id,
            amountMinor: row.amount_minor,
            currency: row.currency,
            status: row.status,
            idempotencyKey: row.idempotency_key,
            version: row.version,
          }
        : null;
    },
    insertIntent(input: CreateIntentInput, requestHash: string, now: number): D1PreparedStatement {
      return database
        .prepare(
          "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(
          input.id,
          input.purpose,
          input.subjectType,
          input.subjectId,
          input.customerId,
          input.amountMinor,
          input.currency,
          input.status,
          input.idempotencyKey,
          now,
          now,
        );
    },
    updateIntentStatusCas(input: {
      intentId: string;
      expectedVersion: number;
      fromStatus: string;
      toStatus: string;
      now: number;
    }): D1PreparedStatement {
      return database
        .prepare(
          "UPDATE payment_intent SET status=?, version=version+1, updated_at=? WHERE id=? AND version=? AND status=?",
        )
        .bind(input.toStatus, input.now, input.intentId, input.expectedVersion, input.fromStatus);
    },
    upsertProviderCustomer(input: {
      customerId: string;
      provider: string;
      providerCustomerRef: string;
      now: number;
    }): D1PreparedStatement {
      return database
        .prepare(
          "INSERT INTO payment_provider_customer (id, customer_id, provider, provider_customer_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(customer_id) DO UPDATE SET provider_customer_ref=excluded.provider_customer_ref, updated_at=excluded.updated_at WHERE payment_provider_customer.provider=excluded.provider",
        )
        .bind(
          crypto.randomUUID(),
          input.customerId,
          input.provider,
          input.providerCustomerRef,
          input.now,
          input.now,
        );
    },
    findProviderCustomer(customerId: string, provider: string): Promise<string | null> {
      return database
        .prepare(
          "SELECT provider_customer_ref FROM payment_provider_customer WHERE customer_id=? AND provider=?",
        )
        .bind(customerId, provider)
        .first<{ provider_customer_ref: string }>()
        .then((row) => row?.provider_customer_ref ?? null);
    },
    recordAttempt(input: {
      attemptId: string;
      intentId: string;
      customerId: string;
      amountMinor: number;
      currency: string;
      status: string;
      provider: string;
      providerReference: string;
      now: number;
    }): D1PreparedStatement {
      return database
        .prepare(
          "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          input.attemptId,
          input.customerId,
          input.intentId,
          input.amountMinor,
          input.currency,
          input.status,
          input.provider,
          input.providerReference,
          `intent:${input.intentId}`,
          input.now,
          input.now,
        );
    },
    recordReconciliationCase(input: {
      intentId: string | null;
      category: string;
      detailsJson: string;
      now: number;
    }): Promise<void> {
      return database
        .prepare(
          "INSERT INTO payment_reconciliation_case (id, payment_intent_id, category, status, details_json, created_at) VALUES (?, ?, ?, 'OPEN', ?, ?)",
        )
        .bind(crypto.randomUUID(), input.intentId, input.category, input.detailsJson, input.now)
        .run()
        .then(() => undefined);
    },
  };
}

export type PaymentRepository = ReturnType<typeof createPaymentRepository>;
