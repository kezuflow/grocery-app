import type { ReceivingCommandRequest, ReceivingRecordState } from "@freshmarkets/contracts";
import type { AppErrorCode } from "@freshmarkets/contracts";
import { recordReceivedLine as recordReceivedLineCommand } from "./record-received-line";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type ReceiveProcurementPorts = {
  /** Capability + location-scope authorization resolved by the caller. */
  authorize: (locationId: string) => Promise<boolean>;
};

export type ReceiveProcurementResult =
  | {
      ok: true;
      value: {
        receivingRecordId: string;
        status: ReceivingRecordState;
        acceptedBase: number;
        rejectedBase: number;
        remainingBase: number;
        version: number;
      };
      requestId: string;
    }
  | { ok: false; error: { code: AppErrorCode; message: string; requestId: string } };

/**
 * Record a received line against a requirement's first started receiving record.
 * Starting receiving is a separate explicit command. Authorization is evaluated
 * against the requirement's own location; quantities are bounded replay-safe
 * deltas enforced by the receiving commands.
 */
export async function receiveProcurement(
  database: D1Database,
  command: ReceivingCommandRequest & { actorId: string },
  ports: ReceiveProcurementPorts,
): Promise<ReceiveProcurementResult> {
  const requirement = await database
    .prepare("SELECT id, location_id, status FROM procurement_requirement WHERE id=?")
    .bind(command.requirementId)
    .first<{ id: string; location_id: string; status: string }>();
  if (!requirement)
    return failure("NOT_FOUND", "Procurement requirement not found", command.requestId);
  if (!(await ports.authorize(requirement.location_id)))
    return failure(
      "FORBIDDEN",
      "Procurement capability and location scope are required",
      command.requestId,
    );
  const record = await database
    .prepare(
      "SELECT id, status, version FROM receiving_record WHERE procurement_requirement_id=? ORDER BY rowid ASC LIMIT 1",
    )
    .bind(command.requirementId)
    .first<{ id: string; status: string; version: number }>();
  if (!record) return failure("NOT_FOUND", "Receiving record not found", command.requestId);
  if (record.status === "NOT_STARTED") {
    return failure(
      "ILLEGAL_TRANSITION",
      "Start receiving before recording quantities",
      command.requestId,
    );
  }
  const result = await recordReceivedLineCommand(database, {
    receivingRecordId: record.id,
    acceptedDeltaBase: command.acceptedQuantity,
    rejectedDeltaBase: command.rejectedQuantity,
    reason: command.reason ?? "PROCUREMENT_RECEIPT",
    expectedVersion: command.expectedVersion,
    idempotencyKey: command.idempotencyKey,
    actorId: command.actorId,
    requestId: command.requestId,
  });
  if (result.ok)
    return {
      ok: true as const,
      value: {
        receivingRecordId: result.value.receivingRecordId,
        status: result.value.status as ReceivingRecordState,
        acceptedBase: result.value.acceptedBase,
        rejectedBase: result.value.rejectedBase,
        remainingBase: result.value.remainingBase,
        version: result.value.version,
      },
      requestId: command.requestId,
    };
  return result;
}
