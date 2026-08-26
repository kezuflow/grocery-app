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
 * Create a DRAFT procurement requirement with its PENDING receiving record in
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
      quantity: command.quantity,
    },
  );
  if (idempotency.existing) {
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
  const id = crypto.randomUUID();
  await database.batch([
    database
      .prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status) VALUES (?, ?, ?, ?, ?, 'DRAFT')",
      )
      .bind(
        id,
        command.deliveryCycleId,
        command.locationId,
        command.inventoryPoolId,
        command.quantity,
      ),
    database
      .prepare(
        "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status) VALUES (?, ?, ?, 0, 0, 'PENDING')",
      )
      .bind(crypto.randomUUID(), id, command.quantity),
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(id, Date.now(), SCOPE, command.idempotencyKey, idempotency.hash),
  ]);
  return { ok: true as const, value: { id, status: "DRAFT" }, requestId: command.requestId };
}
