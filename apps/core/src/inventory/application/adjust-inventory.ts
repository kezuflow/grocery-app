import type { AppErrorCode } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { createInventoryRepository } from "../infrastructure/inventory-repository";
import { auditEventStatement } from "../../audit/application/append-audit-event";
export type AdjustInventoryCommand = {
  requestId: string;
  actorId: string;
  actorAuthUserId?: string;
  locationId: string;
  inventoryPoolId: string;
  deltaBase: number;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};
const resultSchema = z.object({
  locationId: z.string(),
  inventoryPoolId: z.string(),
  onHandBase: z.number().int().safe().nonnegative(),
  reservedBase: z.number().int().safe().nonnegative(),
  version: z.number().int().safe().positive(),
  ledgerEntryId: z.string(),
});
export type InventoryAdjustmentResult = z.infer<typeof resultSchema>;
const SCOPE = "inventory.adjust";
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}
type Result =
  | { ok: true; value: InventoryAdjustmentResult; requestId: string }
  | ReturnType<typeof failure>;
/** Current authority, protected stock, immutable ledger/audit and original replay commit together. */
export async function adjustInventory(
  database: D1Database,
  command: AdjustInventoryCommand,
): Promise<Result> {
  if (
    !Number.isSafeInteger(command.deltaBase) ||
    command.deltaBase === 0 ||
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 0 ||
    !command.reason.trim() ||
    !command.idempotencyKey.trim() ||
    command.idempotencyKey.length > 200
  )
    return failure(
      "VALIDATION_FAILED",
      "A signed integer adjustment, reason, version and stable key are required",
      command.requestId,
    );
  const payload = {
    locationId: command.locationId,
    inventoryPoolId: command.inventoryPoolId,
    deltaBase: command.deltaBase,
    reason: command.reason,
    expectedVersion: command.expectedVersion,
  };
  const legacyHash = await requestHash(payload),
    hash = await requestHash({ ...payload, actor: command.actorAuthUserId ?? null });
  async function replay(): Promise<Result | null> {
    const saved = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash && saved.requestHash !== legacyHash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This key belongs to a different stock adjustment",
        command.requestId,
      );
    if (saved.status === "SUCCEEDED") {
      if (!saved.resultReference?.startsWith("{"))
        return failure(
          "CONFLICT",
          "This historical adjustment was already applied; review its stock ledger",
          command.requestId,
        );
      return {
        ok: true,
        value: resultSchema.parse(JSON.parse(saved.resultReference)),
        requestId: command.requestId,
      };
    }
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  if (
    !(await database
      .prepare(
        "SELECT 1 found FROM fulfillment_location,inventory_pool WHERE fulfillment_location.id=? AND inventory_pool.id=?",
      )
      .bind(command.locationId, command.inventoryPoolId)
      .first())
  )
    return failure("NOT_FOUND", "Inventory location or product pool not found", command.requestId);
  const repository = createInventoryRepository(database),
    before = await repository.readBalance(command.locationId, command.inventoryPoolId);
  if ((before?.version ?? 0) !== command.expectedVersion)
    return failure(
      before ? "STALE_VERSION" : "NOT_FOUND",
      "Inventory changed; refresh before retrying",
      command.requestId,
    );
  const next = (before?.onHand ?? 0) + command.deltaBase;
  if (!Number.isSafeInteger(next) || next < 0 || next < (before?.reserved ?? 0))
    return failure(
      "INSUFFICIENT_STOCK",
      "Adjustment would breach stock invariants",
      command.requestId,
    );
  const held = await database
    .prepare(
      "SELECT COALESCE(SUM(quantity),0) quantity FROM checkout_inventory_holds WHERE location_id=? AND inventory_pool_id=? AND status='HELD'",
    )
    .bind(command.locationId, command.inventoryPoolId)
    .first<{ quantity: number }>();
  if (next - (before?.reserved ?? 0) < (held?.quantity ?? 0))
    return failure(
      "INSUFFICIENT_STOCK",
      "Adjustment would consume checkout-held stock",
      command.requestId,
    );
  const now = Date.now(),
    ledgerEntryId = crypto.randomUUID();
  const result: InventoryAdjustmentResult = {
    locationId: command.locationId,
    inventoryPoolId: command.inventoryPoolId,
    onHandBase: next,
    reservedBase: before?.reserved ?? 0,
    version: command.expectedVersion + 1,
    ledgerEntryId,
  };
  const statements: D1PreparedStatement[] = [];
  if (command.actorAuthUserId)
    statements.push(
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE NOT EXISTS (
    SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='inventory.adjust'
    JOIN staff_scope scope ON scope.staff_id=staff.id JOIN fulfillment_location location ON location.id=?
    WHERE staff.auth_user_id=? AND staff.status='active' AND (scope.scope_kind='global' OR (scope.scope_kind='market' AND scope.market_id=location.market_id) OR (scope.scope_kind='location' AND scope.location_id=location.id)))`)
        .bind(command.locationId, command.actorAuthUserId),
    );
  statements.push(
    database
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','inventory_balance',?,?)
      ON CONFLICT(scope,idempotency_key) DO UPDATE SET request_hash=excluded.request_hash,status='PROCESSING',result_reference=NULL,updated_at=excluded.updated_at WHERE idempotency_records.status IN ('FAILED','PROCESSING') AND idempotency_records.request_hash IN (?,?)`)
      .bind(SCOPE, command.idempotencyKey, hash, now, now, hash, legacyHash),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -39 WHERE changes()<>1"),
    ...repository.adjustmentStatements(command, ledgerEntryId, now),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -39 WHERE NOT EXISTS (SELECT 1 FROM inventory_balance WHERE location_id=? AND inventory_pool_id=? AND on_hand=? AND reserved=? AND version=?)",
      )
      .bind(
        command.locationId,
        command.inventoryPoolId,
        result.onHandBase,
        result.reservedBase,
        result.version,
      ),
    auditEventStatement(database, {
      actorUserId: command.actorAuthUserId ?? null,
      action: "INVENTORY.ADJUSTED",
      resourceType: "inventory_pool",
      resourceId: command.inventoryPoolId,
      locationId: command.locationId,
      reason: command.reason,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.requestId,
      occurredAt: now,
      before: before
        ? { onHandBase: before.onHand, reservedBase: before.reserved, version: before.version }
        : null,
      after: result,
    }),
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(result), now, SCOPE, command.idempotencyKey, hash),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -39 WHERE changes()<>1"),
  );
  try {
    await database.batch(statements);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (
      error instanceof Error &&
      /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
    )
      return failure(
        "STALE_VERSION",
        "Stock, holds or access changed; refresh before retrying",
        command.requestId,
      );
    throw error;
  }
  return { ok: true, value: result, requestId: command.requestId };
}
