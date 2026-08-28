import { claimCommandIdempotency } from "../../idempotency";
import { createReceivingRepository } from "../infrastructure/receiving-repository";
import type { ReceivingResult } from "./record-received-line";

const SCOPE = "procurement.completeReceiving";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/** Explicitly resolve a fully accounted discrepancy into a completed receipt. */
export async function completeReceiving(
  database: D1Database,
  command: {
    receivingRecordId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestId: string;
  },
): Promise<{ ok: true; value: ReceivingResult; requestId: string } | ReturnType<typeof failure>> {
  const repository = createReceivingRepository(database);
  const record = await repository.readRecord(command.receivingRecordId);
  if (!record) return failure("NOT_FOUND", "Receiving record not found", command.requestId);
  const requirement = await repository.readRequirement(record.procurementRequirementId);
  if (!requirement)
    return failure("NOT_FOUND", "Procurement requirement not found", command.requestId);
  const claim = await claimCommandIdempotency(database, Date.now, SCOPE, command.idempotencyKey, {
    receivingRecordId: command.receivingRecordId,
    expectedVersion: command.expectedVersion,
  });
  if (claim.existing) {
    if (claim.existing.requestHash !== claim.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (claim.existing.status === "SUCCEEDED") {
      const current = await repository.readRecord(command.receivingRecordId);
      const balance = await repository.readInventoryBalance(
        requirement.locationId,
        requirement.inventoryPoolId,
      );
      if (current)
        return {
          ok: true,
          value: {
            receivingRecordId: current.id,
            status: current.status,
            acceptedBase: current.acceptedQuantity,
            rejectedBase: current.rejectedQuantity,
            remainingBase:
              current.expectedQuantity - current.acceptedQuantity - current.rejectedQuantity,
            version: current.version,
            inventoryVersion: balance?.version ?? null,
          },
          requestId: command.requestId,
        };
    }
    return failure(
      "CONFLICT",
      "The original completion command is still processing",
      command.requestId,
    );
  }
  if (
    record.status !== "DISCREPANCY" ||
    record.acceptedQuantity + record.rejectedQuantity !== record.expectedQuantity
  ) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=?",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey)
      .run();
    return failure(
      "ILLEGAL_TRANSITION",
      "Only a fully accounted discrepancy can be completed",
      command.requestId,
    );
  }
  const result = await database.batch([
    database
      .prepare(
        "UPDATE receiving_record SET status='COMPLETED', version=version+1 WHERE id=? AND status='DISCREPANCY' AND version=?",
      )
      .bind(record.id, command.expectedVersion),
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND EXISTS (SELECT 1 FROM receiving_record WHERE id=? AND status='COMPLETED' AND version=?)",
      )
      .bind(
        record.id,
        Date.now(),
        SCOPE,
        command.idempotencyKey,
        record.id,
        command.expectedVersion + 1,
      ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=?",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey)
      .run();
    return failure(
      "STALE_VERSION",
      "Receiving record changed; refresh before completing",
      command.requestId,
    );
  }
  const completed = await repository.readRecord(record.id);
  const balance = await repository.readInventoryBalance(
    requirement.locationId,
    requirement.inventoryPoolId,
  );
  if (!completed) return failure("NOT_FOUND", "Receiving record not found", command.requestId);
  return {
    ok: true,
    value: {
      receivingRecordId: completed.id,
      status: completed.status,
      acceptedBase: completed.acceptedQuantity,
      rejectedBase: completed.rejectedQuantity,
      remainingBase:
        completed.expectedQuantity - completed.acceptedQuantity - completed.rejectedQuantity,
      version: completed.version,
      inventoryVersion: balance?.version ?? null,
    },
    requestId: command.requestId,
  };
}
