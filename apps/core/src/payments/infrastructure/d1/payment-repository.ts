import type { ProviderSettlementObservation } from "../../ports/payment-provider";

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

export type ProviderActionRow = {
  actionType: "REDIRECT" | "SDK";
  redirectUrl: string | null;
  clientToken: string | null;
  expiresAt: number;
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
    async upsertProviderCustomer(input: {
      customerId: string;
      provider: string;
      providerCustomerRef: string;
      now: number;
    }): Promise<D1Result<unknown>> {
      const result = await database
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
        )
        .run();
      if ((result.meta?.changes ?? 0) !== 1)
        throw new Error("PROVIDER_CUSTOMER_OWNERSHIP_CONFLICT");
      return result;
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
    async findActiveProviderAction(
      paymentIntentId: string,
      now: number,
    ): Promise<ProviderActionRow | null> {
      await database
        .prepare(
          "UPDATE payment_provider_action SET status='EXPIRED', updated_at=? WHERE payment_intent_id=? AND status='ACTIVE' AND expires_at<=?",
        )
        .bind(now, paymentIntentId, now)
        .run();
      const row = await database
        .prepare(
          "SELECT action_type, redirect_url, client_token, expires_at FROM payment_provider_action WHERE payment_intent_id=? AND status='ACTIVE' AND expires_at>?",
        )
        .bind(paymentIntentId, now)
        .first<{
          action_type: "REDIRECT" | "SDK";
          redirect_url: string | null;
          client_token: string | null;
          expires_at: number;
        }>();
      return row
        ? {
            actionType: row.action_type,
            redirectUrl: row.redirect_url,
            clientToken: row.client_token,
            expiresAt: row.expires_at,
          }
        : null;
    },
    recordProviderActionStatement(input: {
      paymentIntentId: string;
      provider: string;
      providerReference: string;
      actionType: "REDIRECT" | "SDK";
      redirectUrl: string | null;
      clientToken: string | null;
      expiresAt: number;
      now: number;
    }): D1PreparedStatement {
      return database
        .prepare(
          "INSERT INTO payment_provider_action (id, payment_intent_id, authorization_id, provider, provider_reference, action_type, redirect_url, client_token, expires_at, status, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          input.paymentIntentId,
          input.provider,
          input.providerReference,
          input.actionType,
          input.redirectUrl,
          input.clientToken,
          input.expiresAt,
          input.now,
          input.now,
        );
    },
    async findActiveAuthorizationAction(
      authorizationId: string,
      now: number,
    ): Promise<ProviderActionRow | null> {
      await database
        .prepare(
          "UPDATE payment_provider_action SET status='EXPIRED', updated_at=? WHERE authorization_id=? AND status='ACTIVE' AND expires_at<=?",
        )
        .bind(now, authorizationId, now)
        .run();
      const row = await database
        .prepare(
          "SELECT action_type, redirect_url, client_token, expires_at FROM payment_provider_action WHERE authorization_id=? AND status='ACTIVE' AND expires_at>?",
        )
        .bind(authorizationId, now)
        .first<{
          action_type: "REDIRECT" | "SDK";
          redirect_url: string | null;
          client_token: string | null;
          expires_at: number;
        }>();
      return row
        ? {
            actionType: row.action_type,
            redirectUrl: row.redirect_url,
            clientToken: row.client_token,
            expiresAt: row.expires_at,
          }
        : null;
    },
    hasAuthorizationProviderAction(authorizationId: string): Promise<boolean> {
      return database
        .prepare("SELECT 1 AS present FROM payment_provider_action WHERE authorization_id=?")
        .bind(authorizationId)
        .first<{ present: number }>()
        .then((row) => Boolean(row));
    },
    recordAuthorizationActionStatement(input: {
      authorizationId: string;
      provider: string;
      providerReference: string;
      actionType: "REDIRECT" | "SDK";
      redirectUrl: string | null;
      clientToken: string | null;
      expiresAt: number;
      now: number;
    }): D1PreparedStatement {
      return database
        .prepare(
          "INSERT INTO payment_provider_action (id, payment_intent_id, authorization_id, provider, provider_reference, action_type, redirect_url, client_token, expires_at, status, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          input.authorizationId,
          input.provider,
          input.providerReference,
          input.actionType,
          input.redirectUrl,
          input.clientToken,
          input.expiresAt,
          input.now,
          input.now,
        );
    },
    consumeProviderActionsStatement(paymentIntentId: string, now: number): D1PreparedStatement {
      return database
        .prepare(
          "UPDATE payment_provider_action SET status='CONSUMED', updated_at=? WHERE payment_intent_id=? AND status='ACTIVE'",
        )
        .bind(now, paymentIntentId);
    },
    consumeAuthorizationActionsStatement(
      authorizationId: string,
      now: number,
    ): D1PreparedStatement {
      return database
        .prepare(
          "UPDATE payment_provider_action SET status='CONSUMED', updated_at=? WHERE authorization_id=? AND status='ACTIVE'",
        )
        .bind(now, authorizationId);
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

export type InboxRow = {
  id: string;
  provider: string;
  providerEventId: string;
  payloadHash: string;
  processingStatus: string;
  normalizedObservationJson: string | null;
  rawPayload: string | null;
  signatureVerifiedAt: number | null;
  attempts: number;
  receivedAt: number;
  availableAt: number | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
};

export function extendPaymentRepository(database: D1Database) {
  const base = createPaymentRepository(database);
  return {
    ...base,
    insertWebhookReceipt(input: {
      provider: string;
      requestId: string;
      providerEventId: string | null;
      eventType: string | null;
      payloadHash: string;
      rawPayload: string;
      parseStatus: "PARSED" | "REJECTED_AFTER_VERIFICATION";
      now: number;
    }): Promise<void> {
      return database
        .prepare(
          "INSERT INTO payment_provider_webhook_receipt (id, provider, request_id, provider_event_id, event_type, payload_hash, raw_payload, parse_status, signature_verified_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          input.provider,
          input.requestId,
          input.providerEventId,
          input.eventType,
          input.payloadHash,
          input.rawPayload,
          input.parseStatus,
          input.now,
          input.now,
        )
        .run()
        .then(() => undefined);
    },
    async findIntentByProviderReference(
      provider: string,
      providerReference: string,
    ): Promise<PaymentIntentRow[]> {
      const rows = await database
        .prepare(
          "SELECT pi.id, pi.purpose, pi.subject_type, pi.subject_id, pi.customer_id, pi.amount_minor, pi.currency, pi.status, pi.idempotency_key, pi.version FROM payment_intent pi JOIN payment_attempt pa ON pa.payment_intent_id=pi.id WHERE pa.provider=? AND pa.provider_reference=? ORDER BY pi.created_at DESC",
        )
        .bind(provider, providerReference)
        .all<{
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
      return rows.results.map((row) => ({
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
      }));
    },
    async findInboxEntry(provider: string, providerEventId: string): Promise<InboxRow | null> {
      const row = await database
        .prepare(
          "SELECT id, provider, provider_event_id, payload_hash, processing_status, normalized_observation_json, raw_payload, signature_verified_at, attempts, received_at, available_at, lease_owner, lease_expires_at FROM payment_provider_event_inbox WHERE provider=? AND provider_event_id=?",
        )
        .bind(provider, providerEventId)
        .first<{
          id: string;
          provider: string;
          provider_event_id: string;
          payload_hash: string;
          processing_status: string;
          normalized_observation_json: string | null;
          raw_payload: string | null;
          signature_verified_at: number | null;
          attempts: number;
          received_at: number;
          available_at: number | null;
          lease_owner: string | null;
          lease_expires_at: number | null;
        }>();
      return row
        ? {
            id: row.id,
            provider: row.provider,
            providerEventId: row.provider_event_id,
            payloadHash: row.payload_hash,
            processingStatus: row.processing_status,
            normalizedObservationJson: row.normalized_observation_json,
            rawPayload: row.raw_payload,
            signatureVerifiedAt: row.signature_verified_at,
            attempts: row.attempts,
            receivedAt: row.received_at,
            availableAt: row.available_at,
            leaseOwner: row.lease_owner,
            leaseExpiresAt: row.lease_expires_at,
          }
        : null;
    },
    insertInbox(input: {
      provider: string;
      providerEventId: string;
      payloadHash: string;
      providerReference: string;
      eventType: string;
      normalizedObservationJson: string;
      rawPayload: string;
      signatureVerifiedAt: number;
      now: number;
    }): Promise<number> {
      return database
        .prepare(
          "INSERT OR IGNORE INTO payment_provider_event_inbox (id, provider, provider_event_id, payload_hash, provider_reference, event_type, normalized_observation_json, raw_payload, signature_verified_at, processing_status, attempts, received_at, available_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 0, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          input.provider,
          input.providerEventId,
          input.payloadHash,
          input.providerReference,
          input.eventType,
          input.normalizedObservationJson,
          input.rawPayload,
          input.signatureVerifiedAt,
          input.now,
          input.now,
          input.now,
        )
        .run()
        .then((result) => result.meta?.changes ?? 0);
    },
    setInboxStatus(input: {
      id: string;
      processingStatus: string;
      errorCode?: string | null;
      now: number;
      leaseOwner?: string;
    }): Promise<void> {
      const retry = input.processingStatus === "RETRY_REQUIRED";
      return database
        .prepare(
          `UPDATE payment_provider_event_inbox
           SET processing_status=?, last_error_code=?, attempts=attempts+1,
               first_failed_at=CASE WHEN ? THEN COALESCE(first_failed_at, ?) ELSE first_failed_at END,
               available_at=CASE WHEN ? THEN ? + MIN(900000, 1000 * (1 << MIN(attempts, 9))) ELSE NULL END,
               processed_at=CASE WHEN ? THEN NULL ELSE ? END,
               lease_owner=NULL, lease_expires_at=NULL, updated_at=?
           WHERE id=? AND (? IS NULL OR lease_owner=?)`,
        )
        .bind(
          input.processingStatus,
          input.errorCode ?? null,
          retry ? 1 : 0,
          input.now,
          retry ? 1 : 0,
          input.now,
          retry ? 1 : 0,
          input.now,
          input.now,
          input.id,
          input.leaseOwner ?? null,
          input.leaseOwner ?? null,
        )
        .run()
        .then(() => undefined);
    },
    claimInbox(input: { id: string; leaseOwner: string; now: number; leaseMs: number }) {
      return database
        .prepare(
          `UPDATE payment_provider_event_inbox
           SET lease_owner=?, lease_expires_at=?, updated_at=?
           WHERE id=?
             AND processing_status IN ('RECEIVED','RETRY_REQUIRED')
             AND (available_at IS NULL OR available_at<=?)
             AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=?)`,
        )
        .bind(
          input.leaseOwner,
          input.now + input.leaseMs,
          input.now,
          input.id,
          input.now,
          input.now,
        )
        .run()
        .then((outcome) => outcome.meta?.changes ?? 0);
    },
    async listDueInbox(now: number, limit: number): Promise<InboxRow[]> {
      const rows = await database
        .prepare(
          `SELECT id, provider, provider_event_id, payload_hash, processing_status,
                  normalized_observation_json, raw_payload, signature_verified_at,
                  attempts, received_at, available_at,
                  lease_owner, lease_expires_at
           FROM payment_provider_event_inbox
           WHERE processing_status IN ('RECEIVED','RETRY_REQUIRED')
             AND normalized_observation_json IS NOT NULL
             AND (available_at IS NULL OR available_at<=?)
             AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=?)
           ORDER BY COALESCE(available_at, received_at), received_at, id LIMIT ?`,
        )
        .bind(now, now, limit)
        .all<{
          id: string;
          provider: string;
          provider_event_id: string;
          payload_hash: string;
          processing_status: string;
          normalized_observation_json: string | null;
          raw_payload: string | null;
          signature_verified_at: number | null;
          attempts: number;
          received_at: number;
          available_at: number | null;
          lease_owner: string | null;
          lease_expires_at: number | null;
        }>();
      return rows.results.map((row) => ({
        id: row.id,
        provider: row.provider,
        providerEventId: row.provider_event_id,
        payloadHash: row.payload_hash,
        processingStatus: row.processing_status,
        normalizedObservationJson: row.normalized_observation_json,
        rawPayload: row.raw_payload,
        signatureVerifiedAt: row.signature_verified_at,
        attempts: row.attempts,
        receivedAt: row.received_at,
        availableAt: row.available_at,
        leaseOwner: row.lease_owner,
        leaseExpiresAt: row.lease_expires_at,
      }));
    },
    recordSettlementObservationStatement(input: {
      provider: string;
      providerEventId: string;
      paymentIntentId: string;
      settlement: ProviderSettlementObservation;
      now: number;
      paymentGuard?: { version: number; status: string };
      refundGuard?: { refundId: string; version: number; status: string };
    }): D1PreparedStatement {
      const guard = input.paymentGuard;
      const refundGuard = input.refundGuard;
      return database
        .prepare(
          `INSERT OR IGNORE INTO payment_settlement_observation (
             id, provider, provider_event_id, payment_intent_id,
             gross_minor, processing_cost_minor, withholding_minor,
             adjustment_minor, net_minor, currency, observed_at, created_at
           )
           SELECT ?, ?, ?, pi.id, ?, ?, ?, ?, ?, ?, ?, ?
           FROM payment_intent pi
           WHERE pi.id=?
             AND (? IS NULL OR (pi.version=? AND pi.status=?))
             AND (? IS NULL OR EXISTS (
               SELECT 1 FROM payment_refund pr
               WHERE pr.id=? AND pr.payment_intent_id=pi.id
                 AND pr.version=? AND pr.status=?
             ))`,
        )
        .bind(
          crypto.randomUUID(),
          input.provider,
          input.providerEventId,
          input.settlement.grossMinor,
          input.settlement.processingCostMinor,
          input.settlement.withholdingMinor,
          input.settlement.adjustmentMinor,
          input.settlement.netMinor,
          input.settlement.currency,
          input.settlement.observedAt,
          input.now,
          input.paymentIntentId,
          guard ? 1 : null,
          guard?.version ?? null,
          guard?.status ?? null,
          refundGuard ? 1 : null,
          refundGuard?.refundId ?? null,
          refundGuard?.version ?? null,
          refundGuard?.status ?? null,
        );
    },
    recordSettlementObservation(input: {
      provider: string;
      providerEventId: string;
      paymentIntentId: string;
      settlement: ProviderSettlementObservation;
      now: number;
    }): Promise<number> {
      return this.recordSettlementObservationStatement(input)
        .run()
        .then((result) => result.meta?.changes ?? 0);
    },
    applyObservationWithReaction(input: {
      intentId: string;
      expectedVersion: number;
      expectedStatus: string;
      nextStatus: string;
      now: number;
      consumeProviderActions: boolean;
      reaction: {
        reactionType: string;
        subjectType: string;
        subjectId: string;
        idempotencyKey: string;
        now: number;
      } | null;
      settlementObservation?: {
        provider: string;
        providerEventId: string;
        paymentIntentId: string;
        settlement: ProviderSettlementObservation;
        now: number;
      };
    }): Promise<boolean> {
      const statements: D1PreparedStatement[] = [
        database
          .prepare(
            "UPDATE payment_intent SET status=?, version=version+1, updated_at=? WHERE id=? AND version=? AND status=?",
          )
          .bind(
            input.nextStatus,
            input.now,
            input.intentId,
            input.expectedVersion,
            input.expectedStatus,
          ),
        database
          .prepare("UPDATE payment_attempt SET status=?, updated_at=? WHERE payment_intent_id=?")
          .bind(input.nextStatus, input.now, input.intentId),
      ];
      if (input.reaction)
        statements.push(
          database
            .prepare(
              "INSERT OR IGNORE INTO payment_reaction (id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, 0, ?, ?)",
            )
            .bind(
              crypto.randomUUID(),
              input.intentId,
              input.reaction.reactionType,
              input.reaction.subjectType,
              input.reaction.subjectId,
              input.reaction.idempotencyKey,
              input.reaction.now,
              input.reaction.now,
            ),
        );
      if (input.consumeProviderActions)
        statements.push(base.consumeProviderActionsStatement(input.intentId, input.now));
      if (input.settlementObservation)
        statements.push(
          this.recordSettlementObservationStatement({
            ...input.settlementObservation,
            paymentGuard: {
              version: input.expectedVersion + 1,
              status: input.nextStatus,
            },
          }),
        );
      return database
        .batch(statements)
        .then((results) => (results[0]?.meta?.changes ?? 0) === 1)
        .catch(() => false);
    },
  };
}

export type ExtendedPaymentRepository = ReturnType<typeof extendPaymentRepository>;

export type RefundRow = {
  id: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  status: string;
  providerRefundReference: string | null;
  version: number;
};

export function extendPaymentRepositoryForRefunds(database: D1Database) {
  const base = extendPaymentRepository(database);
  return {
    ...base,
    async findRefundByIdempotencyKey(idempotencyKey: string): Promise<RefundRow | null> {
      const row = await database
        .prepare(
          "SELECT id, payment_intent_id, amount_minor, currency, status, provider_refund_reference, version FROM payment_refund WHERE idempotency_key=?",
        )
        .bind(idempotencyKey)
        .first<{
          id: string;
          payment_intent_id: string;
          amount_minor: number;
          currency: string;
          status: string;
          provider_refund_reference: string | null;
          version: number;
        }>();
      return row
        ? {
            id: row.id,
            paymentIntentId: row.payment_intent_id,
            amountMinor: row.amount_minor,
            currency: row.currency,
            status: row.status,
            providerRefundReference: row.provider_refund_reference,
            version: row.version,
          }
        : null;
    },
    claimRefundBudget(input: {
      refundId: string;
      intentId: string;
      amountMinor: number;
      reason: string | null;
      idempotencyKey: string;
      now: number;
    }): Promise<boolean> {
      return database
        .prepare(
          `INSERT INTO payment_refund (
             id, payment_intent_id, amount_minor, currency, status, reason,
             idempotency_key, version, created_at, updated_at
           )
           SELECT ?, pi.id, ?, pi.currency, 'REQUESTED', ?, ?, 1, ?, ?
           FROM payment_intent pi
           WHERE pi.id=? AND pi.status IN ('SUCCEEDED','PARTIALLY_REFUNDED')
             AND ? <= pi.amount_minor - COALESCE((
               SELECT SUM(pr.amount_minor) FROM payment_refund pr
               WHERE pr.payment_intent_id=pi.id
                 AND pr.status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED','SUCCEEDED')
             ), 0)`,
        )
        .bind(
          input.refundId,
          input.amountMinor,
          input.reason,
          input.idempotencyKey,
          input.now,
          input.now,
          input.intentId,
          input.amountMinor,
        )
        .run()
        .then((result) => (result.meta?.changes ?? 0) === 1);
    },
    updateRefundStatusCas(input: {
      refundId: string;
      expectedVersion: number;
      fromStatus: string;
      toStatus: string;
      providerRefundReference?: string | null;
      settlementObservation?: {
        provider: string;
        providerEventId: string;
        paymentIntentId: string;
        settlement: ProviderSettlementObservation;
        now: number;
      };
      now: number;
    }): Promise<number> {
      const update = database
        .prepare(
          "UPDATE payment_refund SET status=?, provider_refund_reference=COALESCE(?, provider_refund_reference), version=version+1, updated_at=? WHERE id=? AND version=? AND status=?",
        )
        .bind(
          input.toStatus,
          input.providerRefundReference ?? null,
          input.now,
          input.refundId,
          input.expectedVersion,
          input.fromStatus,
        );
      if (!input.settlementObservation)
        return update.run().then((result) => result.meta?.changes ?? 0);
      const settlement = base.recordSettlementObservationStatement({
        ...input.settlementObservation,
        refundGuard: {
          refundId: input.refundId,
          version: input.expectedVersion + 1,
          status: input.toStatus,
        },
      });
      return database.batch([update, settlement]).then((results) => results[0]?.meta?.changes ?? 0);
    },
    findRefundByProviderReference(refundReference: string): Promise<RefundRow | null> {
      return database
        .prepare(
          "SELECT id, payment_intent_id, amount_minor, currency, status, provider_refund_reference, version FROM payment_refund WHERE provider_refund_reference=?",
        )
        .bind(refundReference)
        .first<{
          id: string;
          payment_intent_id: string;
          amount_minor: number;
          currency: string;
          status: string;
          provider_refund_reference: string;
          version: number;
        }>()
        .then((row) =>
          row
            ? {
                id: row.id,
                paymentIntentId: row.payment_intent_id,
                amountMinor: row.amount_minor,
                currency: row.currency,
                status: row.status,
                providerRefundReference: row.provider_refund_reference,
                version: row.version,
              }
            : null,
        );
    },
    refreshIntentRefundState(intentId: string, now: number): Promise<number> {
      return database
        .prepare(
          `UPDATE payment_intent
           SET status=CASE
                 WHEN (SELECT COALESCE(SUM(amount_minor),0) FROM payment_refund WHERE payment_intent_id=? AND status='SUCCEEDED') >= amount_minor
                   THEN 'REFUNDED'
                 ELSE 'PARTIALLY_REFUNDED'
               END,
               version=version+1,
               updated_at=?
           WHERE id=? AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED')`,
        )
        .bind(intentId, now, intentId)
        .run()
        .then((result) => result.meta?.changes ?? 0);
    },
  };
}

export type ExtendedRefundRepository = ReturnType<typeof extendPaymentRepositoryForRefunds>;
