import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  createInventoryRepository,
  findLedgerEntryForKey,
  markAdjustmentFailed,
} from "../infrastructure/inventory-repository";

export type AdjustInventoryCommand = {
  requestId: string;
  actorId: string;
  locationId: string;
  inventoryPoolId: string;
  deltaBase: number;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type InventoryAdjustmentResult = {
  locationId: string;
  inventoryPoolId: string;
  onHandBase: number;
  reservedBase: number;
  version: number;
  ledgerEntryId: string;
};

type AdjustmentFailureCode =
  | "STALE_VERSION"
  | "INSUFFICIENT_STOCK"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "CONFLICT";

const ADJUSTMENT_SCOPE = "inventory.adjust";

function failure(code: AdjustmentFailureCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function success(value: InventoryAdjustmentResult, requestId: string) {
  return { ok: true as const, value, requestId };
}

/**
 * Atomic manual inventory adjustment: the balance change, its ledger evidence,
 * and the idempotency completion commit in one D1 transaction. Retries with the
 * same stable key replay the original result; concurrent stale writes lose
 * safely without partial effects.
 */
export async function adjustInventory(
  database: D1Database,
  command: AdjustInventoryCommand,
): Promise<ReturnType<typeof success> | ReturnType<typeof failure>> {
  const repository = createInventoryRepository(database);
  const hash = await requestHash({
    locationId: command.locationId,
    inventoryPoolId: command.inventoryPoolId,
    deltaBase: command.deltaBase,
    reason: command.reason,
    expectedVersion: command.expectedVersion,
  });

  const balance = await repository.readBalance(command.locationId, command.inventoryPoolId);

  const execution = await repository.executeAdjustment(
    {
      locationId: command.locationId,
      inventoryPoolId: command.inventoryPoolId,
      deltaBase: command.deltaBase,
      reason: command.reason,
      actorId: command.actorId,
      expectedVersion: command.expectedVersion,
      idempotencyKey: command.idempotencyKey,
    },
    hash,
  );

  if (!execution.claimed) {
    if (execution.existingRequestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (execution.existingStatus === "SUCCEEDED") {
      const replayed = await repository.readBalance(command.locationId, command.inventoryPoolId);
      const ledgerEntryId = await findLedgerEntryForKey(database, command.idempotencyKey);
      if (replayed && ledgerEntryId)
        return success(
          {
            locationId: command.locationId,
            inventoryPoolId: command.inventoryPoolId,
            onHandBase: replayed.onHand,
            reservedBase: replayed.reserved,
            version: replayed.version,
            ledgerEntryId,
          },
          command.requestId,
        );
    }
    return failure(
      "CONFLICT",
      "The original inventory command is still processing",
      command.requestId,
    );
  }

  const record = await findIdempotencyRecord(database, ADJUSTMENT_SCOPE, command.idempotencyKey);
  if (record?.status !== "SUCCEEDED") {
    await markAdjustmentFailed(database, command.idempotencyKey);
    const current = await repository.readBalance(command.locationId, command.inventoryPoolId);
    if (!current && command.expectedVersion > 0)
      return failure("NOT_FOUND", "Inventory balance not found", command.requestId);
    if (current && current.version !== command.expectedVersion)
      return failure(
        "STALE_VERSION",
        "Inventory changed; refresh before retrying",
        command.requestId,
      );
    return failure(
      "INSUFFICIENT_STOCK",
      "Adjustment would breach stock invariants",
      command.requestId,
    );
  }

  const updated = await repository.readBalance(command.locationId, command.inventoryPoolId);
  return success(
    {
      locationId: command.locationId,
      inventoryPoolId: command.inventoryPoolId,
      onHandBase: updated?.onHand ?? command.deltaBase,
      reservedBase: updated?.reserved ?? 0,
      version: updated?.version ?? command.expectedVersion + 1,
      ledgerEntryId: execution.ledgerEntryId,
    },
    command.requestId,
  );
}
