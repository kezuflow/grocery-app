import { requestHash } from "../../idempotency";
import {
  START_RECEIVING_SCOPE,
  createReceivingRepository,
} from "../infrastructure/receiving-repository";
import type { ReceivingResult } from "./record-received-line";

export type StartReceivingCommand = {
  requirementId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Begin receiving against a pending receipt for an orderable requirement. The
 * transition to `IN_PROGRESS` and its idempotency completion are atomic, and
 * retries with the same stable key replay the original result.
 */
export async function startReceiving(
  database: D1Database,
  command: StartReceivingCommand,
): Promise<{ ok: true; value: ReceivingResult; requestId: string } | ReturnType<typeof failure>> {
  const repository = createReceivingRepository(database);
  const record = await repository.readRecordByRequirement(command.requirementId);
  if (!record) return failure("NOT_FOUND", "Receiving record not found", command.requestId);
  const requirement = await repository.readRequirement(command.requirementId);
  if (!requirement)
    return failure("NOT_FOUND", "Procurement requirement not found", command.requestId);

  const hash = await requestHash({ requirementId: command.requirementId });
  const claim = await repository.startReceivingRecord(
    record.id,
    command.expectedVersion,
    command.idempotencyKey,
    hash,
  );
  if (!claim.claimed) {
    if (claim.existingRequestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (claim.existingStatus === "SUCCEEDED") {
      const started = await repository.readRecord(record.id);
      const balance = await repository.readInventoryBalance(
        requirement.locationId,
        requirement.inventoryPoolId,
      );
      if (started)
        return {
          ok: true,
          value: {
            receivingRecordId: started.id,
            status: started.status,
            acceptedBase: started.acceptedQuantity,
            rejectedBase: started.rejectedQuantity,
            remainingBase:
              started.expectedQuantity - started.acceptedQuantity - started.rejectedQuantity,
            version: started.version,
            inventoryVersion: balance?.version ?? null,
          },
          requestId: command.requestId,
        };
    }
    return failure(
      "CONFLICT",
      claim.existingStatus === "FAILED"
        ? "The original receiving command failed; retry with a new idempotency key"
        : "The original receiving command is still processing",
      command.requestId,
    );
  }

  if (requirement.status !== "ORDERED" && requirement.status !== "PARTIALLY_RECEIVED") {
    await repository.markFailed(START_RECEIVING_SCOPE, command.idempotencyKey);
    return failure(
      "ILLEGAL_TRANSITION",
      "Receiving requires an ordered or partially received requirement",
      command.requestId,
    );
  }
  if (record.status !== "NOT_STARTED") {
    await repository.markFailed(START_RECEIVING_SCOPE, command.idempotencyKey);
    return failure(
      "ILLEGAL_TRANSITION",
      "Receiving has already started for this record",
      command.requestId,
    );
  }

  const started = await repository.readRecord(record.id);
  if (started?.status !== "IN_PROGRESS") {
    await repository.markFailed(START_RECEIVING_SCOPE, command.idempotencyKey);
    if (started && started.version !== command.expectedVersion)
      return failure(
        "STALE_VERSION",
        "Receiving record changed; refresh before retrying",
        command.requestId,
      );
    return failure("ILLEGAL_TRANSITION", "Receiving record is not startable", command.requestId);
  }
  const balance = await repository.readInventoryBalance(
    requirement.locationId,
    requirement.inventoryPoolId,
  );
  return {
    ok: true,
    value: {
      receivingRecordId: started.id,
      status: started.status,
      acceptedBase: started.acceptedQuantity,
      rejectedBase: started.rejectedQuantity,
      remainingBase: started.expectedQuantity - started.acceptedQuantity - started.rejectedQuantity,
      version: started.version,
      inventoryVersion: balance?.version ?? null,
    },
    requestId: command.requestId,
  };
}
