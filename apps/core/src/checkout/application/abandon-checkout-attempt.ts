import type { AbandonCheckoutResult, RpcResult } from "@freshmarkets/contracts";
import { claimCommandIdempotency, findIdempotencyRecord, requestHash } from "../../idempotency";

type Command = {
  customerId: string;
  quoteId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
};

const SCOPE = "checkout.abandon";

function failure(
  code: "NOT_FOUND" | "STALE_VERSION" | "CONFLICT" | "IDEMPOTENCY_CONFLICT" | "INTERNAL_ERROR",
  message: string,
  requestId: string,
): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}

function terminalResult(quoteId: string, status: "SUPERSEDED" | "EXPIRED") {
  return {
    quoteId,
    outcome: "ALREADY_TERMINAL" as const,
    quoteStatus: status,
    releasedInventoryHolds: 0,
    releasedCapacityAllocations: 0,
  };
}

function parseResult(value: string | null): AbandonCheckoutResult | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as AbandonCheckoutResult;
  } catch {
    return null;
  }
}

export async function abandonCheckoutAttempt(
  database: D1Database,
  command: Command,
): Promise<RpcResult<AbandonCheckoutResult>> {
  const quote = await database
    .prepare("SELECT status, version FROM checkout_quote WHERE id=? AND customer_id=?")
    .bind(command.quoteId, command.customerId)
    .first<{ status: "ACTIVE" | "CONSUMED" | "EXPIRED" | "SUPERSEDED"; version: number }>();
  if (!quote) return failure("NOT_FOUND", "Quote not found", command.requestId);
  if (quote.status === "CONSUMED")
    return failure(
      "CONFLICT",
      "A committed order cannot be canceled from checkout",
      command.requestId,
    );

  const payload = {
    customerId: command.customerId,
    quoteId: command.quoteId,
    expectedVersion: command.expectedVersion,
  };
  const existing = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
  if (existing) {
    const hash = await requestHash(payload);
    if (existing.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "That idempotency key was already used for a different abandonment request",
        command.requestId,
      );
    const replay = parseResult(existing.resultReference);
    if (existing.status === "SUCCEEDED" && replay)
      return { ok: true, value: replay, requestId: command.requestId };
    if (existing.status === "PROCESSING")
      return failure("CONFLICT", "Abandonment is already processing", command.requestId);
  }

  if (quote.status === "EXPIRED" || quote.status === "SUPERSEDED") {
    const result = terminalResult(command.quoteId, quote.status);
    const claim = await claimCommandIdempotency(
      database,
      Date.now,
      SCOPE,
      command.idempotencyKey,
      payload,
    );
    if (claim.existing && claim.existing.requestHash !== claim.hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", command.requestId);
    if (claim.existing?.status === "SUCCEEDED") {
      const replay = parseResult(claim.existing.resultReference);
      if (replay) return { ok: true, value: replay, requestId: command.requestId };
    }
    await database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=?",
      )
      .bind(JSON.stringify(result), Date.now(), SCOPE, command.idempotencyKey, claim.hash)
      .run();
    return { ok: true, value: result, requestId: command.requestId };
  }
  if (quote.version !== command.expectedVersion)
    return failure("STALE_VERSION", "Quote changed; review it before retrying", command.requestId);

  const riskyPayment = await database
    .prepare(
      `SELECT 1 AS found FROM payment_intent
       WHERE subject_type='checkout_quote' AND subject_id=?
         AND status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')
       LIMIT 1`,
    )
    .bind(command.quoteId)
    .first<{ found: number }>();
  if (riskyPayment)
    return failure(
      "CONFLICT",
      "Payment processing has started; checkout cannot be abandoned safely",
      command.requestId,
    );

  const claim = await claimCommandIdempotency(
    database,
    Date.now,
    SCOPE,
    command.idempotencyKey,
    payload,
  );
  if (claim.existing) {
    if (claim.existing.requestHash !== claim.hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", command.requestId);
    const replay = parseResult(claim.existing.resultReference);
    if (claim.existing.status === "SUCCEEDED" && replay)
      return { ok: true, value: replay, requestId: command.requestId };
    return failure("CONFLICT", "Abandonment is already processing", command.requestId);
  }

  const [holds, allocations] = await Promise.all([
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
      )
      .bind(command.quoteId)
      .first<{ count: number }>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM capacity_allocations WHERE checkout_attempt_id=? AND status='HELD'",
      )
      .bind(command.quoteId)
      .first<{ count: number }>(),
  ]);
  const result: AbandonCheckoutResult = {
    quoteId: command.quoteId,
    outcome: "ABANDONED",
    quoteStatus: "SUPERSEDED",
    releasedInventoryHolds: holds?.count ?? 0,
    releasedCapacityAllocations: allocations?.count ?? 0,
  };
  const now = Date.now();
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO commitment_abort(id)
           SELECT -8 WHERE NOT EXISTS (
             SELECT 1 FROM checkout_quote
             WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?
           )`,
        )
        .bind(command.quoteId, command.customerId, command.expectedVersion),
      database
        .prepare(
          `UPDATE cycle_zone_capacity
           SET allocated=MAX(0,allocated-(SELECT COALESCE(SUM(units),0)
             FROM capacity_allocations ca WHERE ca.checkout_attempt_id=? AND ca.status='HELD'
               AND ca.cycle_id=cycle_zone_capacity.cycle_id
               AND ca.zone_id=cycle_zone_capacity.zone_id
               AND ca.location_id=cycle_zone_capacity.location_id)), version=version+1
           WHERE EXISTS (SELECT 1 FROM capacity_allocations ca
             WHERE ca.checkout_attempt_id=? AND ca.status='HELD'
               AND ca.cycle_id=cycle_zone_capacity.cycle_id
               AND ca.zone_id=cycle_zone_capacity.zone_id
               AND ca.location_id=cycle_zone_capacity.location_id)`,
        )
        .bind(command.quoteId, command.quoteId),
      database
        .prepare(
          "UPDATE capacity_allocations SET status='RELEASED', updated_at=? WHERE checkout_attempt_id=? AND status='HELD'",
        )
        .bind(now, command.quoteId),
      database
        .prepare(
          "UPDATE checkout_inventory_holds SET status='RELEASED', updated_at=? WHERE checkout_attempt_id=? AND status='HELD'",
        )
        .bind(now, command.quoteId),
      database
        .prepare(
          "UPDATE checkout_attempts SET status='EXPIRED', version=version+1, updated_at=? WHERE id=? AND status='PROCESSING'",
        )
        .bind(now, command.quoteId),
      database
        .prepare(
          "UPDATE checkout_quote SET status='SUPERSEDED', version=version+1, updated_at=? WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?",
        )
        .bind(now, command.quoteId, command.customerId, command.expectedVersion),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(result), now, SCOPE, command.idempotencyKey, claim.hash),
    ]);
  } catch {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey, claim.hash)
      .run();
    return failure("CONFLICT", "Quote changed while abandonment was applied", command.requestId);
  }
  return { ok: true, value: result, requestId: command.requestId };
}
