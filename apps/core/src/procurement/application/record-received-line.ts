import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  RECORD_LINE_SCOPE,
  createReceivingRepository,
} from "../infrastructure/receiving-repository";

export type RecordReceivedLineCommand = {
  receivingRecordId: string;
  acceptedDeltaBase: number;
  rejectedDeltaBase: number;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export type ReceivingResult = {
  receivingRecordId: string;
  status: string;
  acceptedBase: number;
  rejectedBase: number;
  remainingBase: number;
  version: number;
  inventoryVersion: number | null;
};

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function resultFrom(
  record: {
    id: string;
    status: string;
    acceptedQuantity: number;
    rejectedQuantity: number;
    expectedQuantity: number;
    version: number;
  },
  inventoryVersion: number | null,
  requestId: string,
): { ok: true; value: ReceivingResult; requestId: string } {
  return {
    ok: true,
    value: {
      receivingRecordId: record.id,
      status: record.status,
      acceptedBase: record.acceptedQuantity,
      rejectedBase: record.rejectedQuantity,
      remainingBase: record.expectedQuantity - record.acceptedQuantity - record.rejectedQuantity,
      version: record.version,
      inventoryVersion,
    },
    requestId,
  };
}

function nextRecordStatus(acceptedTotal: number, rejectedTotal: number, expected: number): string {
  const complete = acceptedTotal + rejectedTotal >= expected;
  if (complete) return rejectedTotal === 0 ? "COMPLETED" : "DISCREPANCY";
  return rejectedTotal > 0 ? "DISCREPANCY" : "IN_PROGRESS";
}

function nextRequirementStatus(
  acceptedTotal: number,
  rejectedTotal: number,
  expected: number,
): string {
  const complete = acceptedTotal + rejectedTotal >= expected;
  if (!complete) return "PARTIALLY_RECEIVED";
  return acceptedTotal === 0 ? "EXCEPTION" : "RECEIVED";
}

/**
 * Append one immutable received line: the receipt totals, the delta event, the
 * inventory and ledger movement for accepted quantity, the requirement state,
 * and the idempotency completion commit atomically. Cumulative quantities can
 * never exceed the expected quantity, and duplicate or reordered commands
 * cannot double-post stock.
 */
export async function recordReceivedLine(
  database: D1Database,
  command: RecordReceivedLineCommand,
): Promise<{ ok: true; value: ReceivingResult; requestId: string } | ReturnType<typeof failure>> {
  if (
    !Number.isInteger(command.acceptedDeltaBase) ||
    !Number.isInteger(command.rejectedDeltaBase) ||
    command.acceptedDeltaBase < 0 ||
    command.rejectedDeltaBase < 0 ||
    command.acceptedDeltaBase + command.rejectedDeltaBase === 0
  )
    return failure(
      "VALIDATION_FAILED",
      "Received quantities must be positive integer base-unit deltas",
      command.requestId,
    );

  const repository = createReceivingRepository(database);
  const record = await repository.readRecord(command.receivingRecordId);
  if (!record) return failure("NOT_FOUND", "Receiving record not found", command.requestId);
  const requirement = await repository.readRequirement(record.procurementRequirementId);
  if (!requirement)
    return failure("NOT_FOUND", "Procurement requirement not found", command.requestId);

  const hash = await requestHash({
    receivingRecordId: command.receivingRecordId,
    acceptedDeltaBase: command.acceptedDeltaBase,
    rejectedDeltaBase: command.rejectedDeltaBase,
    reason: command.reason,
    expectedVersion: command.expectedVersion,
  });
  const claim = await repository.claimIdempotency(RECORD_LINE_SCOPE, command.idempotencyKey, hash);
  if (!claim.claimed) {
    if (claim.existingRequestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (claim.existingStatus === "SUCCEEDED") {
      const current = await repository.readRecord(command.receivingRecordId);
      const balance = await repository.readInventoryBalance(
        requirement.locationId,
        requirement.inventoryPoolId,
      );
      if (current) return resultFrom(current, balance?.version ?? null, command.requestId);
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
    await repository.markFailed(RECORD_LINE_SCOPE, command.idempotencyKey);
    return failure(
      "ILLEGAL_TRANSITION",
      "Receiving requires an ordered or partially received requirement",
      command.requestId,
    );
  }
  if (record.status !== "IN_PROGRESS" && record.status !== "DISCREPANCY") {
    await repository.markFailed(RECORD_LINE_SCOPE, command.idempotencyKey);
    return failure(
      "ILLEGAL_TRANSITION",
      "Receiving has not started for this record",
      command.requestId,
    );
  }

  const acceptedTotal = record.acceptedQuantity + command.acceptedDeltaBase;
  const rejectedTotal = record.rejectedQuantity + command.rejectedDeltaBase;
  await repository.recordReceivedLine({
    receivingRecordId: record.id,
    procurementRequirementId: requirement.id,
    locationId: requirement.locationId,
    inventoryPoolId: requirement.inventoryPoolId,
    acceptedDelta: command.acceptedDeltaBase,
    rejectedDelta: command.rejectedDeltaBase,
    reason: command.reason,
    actorId: command.actorId,
    expectedRecordVersion: command.expectedVersion,
    expectedRequirementVersion: requirement.version,
    nextRecordStatus: nextRecordStatus(acceptedTotal, rejectedTotal, record.expectedQuantity),
    nextRequirementStatus: nextRequirementStatus(
      acceptedTotal,
      rejectedTotal,
      record.expectedQuantity,
    ),
    idempotencyKey: command.idempotencyKey,
    requestHash: hash,
  });

  const completion = await findIdempotencyRecord(
    database,
    RECORD_LINE_SCOPE,
    command.idempotencyKey,
  );
  if (completion?.status !== "SUCCEEDED") {
    await repository.markFailed(RECORD_LINE_SCOPE, command.idempotencyKey);
    const current = await repository.readRecord(command.receivingRecordId);
    if (current) {
      if (
        current.acceptedQuantity +
          current.rejectedQuantity +
          command.acceptedDeltaBase +
          command.rejectedDeltaBase >
        current.expectedQuantity
      )
        return failure(
          "VALIDATION_FAILED",
          "Received quantities exceed the expected quantity",
          command.requestId,
        );
      if (current.version !== command.expectedVersion)
        return failure(
          "STALE_VERSION",
          "Receiving record changed; refresh before retrying",
          command.requestId,
        );
    }
    return failure(
      "ILLEGAL_TRANSITION",
      "Receiving record is not accepting lines",
      command.requestId,
    );
  }

  const updated = await repository.readRecord(command.receivingRecordId);
  const balance = await repository.readInventoryBalance(
    requirement.locationId,
    requirement.inventoryPoolId,
  );
  return resultFrom(
    updated ?? {
      id: record.id,
      status: nextRecordStatus(acceptedTotal, rejectedTotal, record.expectedQuantity),
      acceptedQuantity: acceptedTotal,
      rejectedQuantity: rejectedTotal,
      expectedQuantity: record.expectedQuantity,
      version: command.expectedVersion + 1,
    },
    balance?.version ?? null,
    command.requestId,
  );
}
