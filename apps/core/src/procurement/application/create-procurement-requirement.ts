import type { ProcurementCommandRequest } from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type CreateProcurementRequirementResult =
  | { ok: true; value: { id: string; status: string }; requestId: string }
  | ReturnType<typeof failure>;

const SCOPE = "procurement.createRequirement";

/**
 * Create an AGGREGATED procurement requirement with its NOT_STARTED receiving record in
 * one atomic batch under a stable idempotency key. Replays return the
 * original requirement; a hash mismatch or in-flight original is rejected.
 */
export async function createProcurementRequirement(
  database: D1Database,
  command: ProcurementCommandRequest,
): Promise<CreateProcurementRequirementResult> {
  const idempotency = await claimCommandIdempotency(
    database,
    Date.now,
    SCOPE,
    command.idempotencyKey,
    {
      deliveryCycleId: command.deliveryCycleId,
      locationId: command.locationId,
      inventoryPoolId: command.inventoryPoolId,
      expectedVersion: command.expectedVersion,
    },
  );
  if (!idempotency.claimed) {
    if (!idempotency.existing)
      return failure("CONFLICT", "The procurement command is still processing", command.requestId);
    if (idempotency.existing.requestHash !== idempotency.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (idempotency.existing.status === "SUCCEEDED" && idempotency.existing.resultReference) {
      const prior = await database
        .prepare("SELECT status FROM procurement_requirement WHERE id=?")
        .bind(idempotency.existing.resultReference)
        .first<{ status: string }>();
      if (prior)
        return {
          ok: true as const,
          value: { id: idempotency.existing.resultReference, status: prior.status },
          requestId: command.requestId,
        };
    }
    return failure(
      "CONFLICT",
      "The original procurement command is still processing",
      command.requestId,
    );
  }
  const now = Date.now();
  const markFailed = () =>
    database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(now, SCOPE, command.idempotencyKey)
      .run();
  const totals = await database
    .prepare(`SELECT
      COALESCE((SELECT SUM(quantity) FROM committed_demand WHERE delivery_cycle_id=? AND location_id=? AND inventory_pool_id=? AND status='OPEN'), 0) AS demand,
      COALESCE((SELECT on_hand-reserved FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?), 0) AS available`)
    .bind(
      command.deliveryCycleId,
      command.locationId,
      command.inventoryPoolId,
      command.locationId,
      command.inventoryPoolId,
    )
    .first<{ demand: number; available: number }>();
  const quantity = Math.max(0, (totals?.demand ?? 0) - (totals?.available ?? 0));
  if (quantity === 0) {
    await markFailed();
    return failure(
      "CONFIGURATION_ERROR",
      "No procurement requirement is derived from committed demand",
      command.requestId,
    );
  }

  const active = await database
    .prepare(
      "SELECT id, status, version FROM procurement_requirement WHERE delivery_cycle_id=? AND location_id=? AND inventory_pool_id=? AND status!='CLOSED' LIMIT 1",
    )
    .bind(command.deliveryCycleId, command.locationId, command.inventoryPoolId)
    .first<{ id: string; status: string; version: number }>();
  if (active) {
    if (active.version !== command.expectedVersion) {
      await markFailed();
      return failure(
        "STALE_VERSION",
        "Procurement requirement changed; refresh before retrying",
        command.requestId,
      );
    }
    if (active.status !== "AGGREGATED") {
      await markFailed();
      return failure(
        "ILLEGAL_TRANSITION",
        "Approved or ordered procurement cannot be recalculated",
        command.requestId,
      );
    }
    try {
      await database.batch([
        database
          .prepare(
            "UPDATE procurement_requirement SET required_quantity=?, updated_at=?, version=version+1 WHERE id=? AND status='AGGREGATED' AND version=?",
          )
          .bind(quantity, now, active.id, command.expectedVersion),
        database
          .prepare(
            "INSERT INTO admin_command_abort(id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM procurement_requirement WHERE id=? AND status='AGGREGATED' AND version=?)",
          )
          .bind(active.id, command.expectedVersion + 1),
        database
          .prepare(
            "UPDATE receiving_record SET expected_quantity=?, updated_at=?, version=version+1 WHERE procurement_requirement_id=? AND status='NOT_STARTED'",
          )
          .bind(quantity, now, active.id),
        database
          .prepare(
            "INSERT INTO admin_command_abort(id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM receiving_record WHERE procurement_requirement_id=? AND status='NOT_STARTED' AND expected_quantity=?)",
          )
          .bind(active.id, quantity),
        database
          .prepare(
            "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
          )
          .bind(active.id, now, SCOPE, command.idempotencyKey, idempotency.hash),
      ]);
    } catch {
      await markFailed();
      return failure(
        "STALE_VERSION",
        "Procurement requirement changed; refresh before retrying",
        command.requestId,
      );
    }
    return {
      ok: true,
      value: { id: active.id, status: "AGGREGATED" },
      requestId: command.requestId,
    };
  }
  if (command.expectedVersion !== 0) {
    await markFailed();
    return failure(
      "STALE_VERSION",
      "Procurement requirement no longer exists; refresh before retrying",
      command.requestId,
    );
  }

  const id = crypto.randomUUID();
  try {
    await database.batch([
      database
        .prepare(
          "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'AGGREGATED', 1, ?, ?)",
        )
        .bind(
          id,
          command.deliveryCycleId,
          command.locationId,
          command.inventoryPoolId,
          quantity,
          now,
          now,
        ),
      database
        .prepare(
          "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 'NOT_STARTED', 1, ?, ?)",
        )
        .bind(crypto.randomUUID(), id, quantity, now, now),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(id, now, SCOPE, command.idempotencyKey, idempotency.hash),
    ]);
  } catch (error) {
    await markFailed();
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("procurement_requirement_active_context_unique") ||
      message.includes("UNIQUE")
    )
      return failure(
        "CONFLICT",
        "An active procurement requirement already exists for this context",
        command.requestId,
      );
    throw error;
  }
  return { ok: true, value: { id, status: "AGGREGATED" }, requestId: command.requestId };
}
