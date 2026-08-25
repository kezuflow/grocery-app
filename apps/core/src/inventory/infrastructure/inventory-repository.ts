export type InventoryBalanceRow = {
  onHand: number;
  reserved: number;
  version: number;
};

export type InventoryAdjustmentExecution = {
  ledgerEntryId: string;
  claimed: boolean;
  existingRequestHash: string | null;
  existingStatus: "PROCESSING" | "SUCCEEDED" | "FAILED" | null;
};

export type RepositoryAdjustmentCommand = {
  locationId: string;
  inventoryPoolId: string;
  deltaBase: number;
  reason: string;
  actorId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

const ADJUSTMENT_SCOPE = "inventory.adjust";

export type InventoryRepository = {
  readBalance(locationId: string, inventoryPoolId: string): Promise<InventoryBalanceRow | null>;
  executeAdjustment(
    command: RepositoryAdjustmentCommand,
    requestHash: string,
  ): Promise<InventoryAdjustmentExecution>;
};

export function createInventoryRepository(database: D1Database): InventoryRepository {
  return {
    async readBalance(locationId, inventoryPoolId) {
      const row = await database
        .prepare(
          "SELECT on_hand, reserved, version FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
        )
        .bind(locationId, inventoryPoolId)
        .first<{ on_hand: number; reserved: number; version: number }>();
      return row ? { onHand: row.on_hand, reserved: row.reserved, version: row.version } : null;
    },
    async executeAdjustment(command, requestHash) {
      const ledgerEntryId = crypto.randomUUID();
      const now = Date.now();
      const balanceIdentity = `${command.locationId}:${command.inventoryPoolId}`;
      const statements = [
        database
          .prepare(
            "INSERT INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, 'inventory_balance', 'PROCESSING', ?, ?)",
          )
          .bind(ADJUSTMENT_SCOPE, command.idempotencyKey, requestHash, now, now),
        // One guarded upsert owns the balance mutation: it inserts only when the
        // caller expects absence, and updates only when the observed version and
        // the resulting stock invariants hold. Any other case leaves it a no-op.
        database
          .prepare(
            "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) SELECT ?, ?, ?, 0, 1 WHERE (?=0 AND ?>=0 AND NOT EXISTS (SELECT 1 FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?)) OR EXISTS (SELECT 1 FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=on_hand+?, version=version+1 WHERE inventory_balance.version=? AND on_hand+?>=0 AND on_hand+?-reserved>=0",
          )
          .bind(
            command.locationId,
            command.inventoryPoolId,
            command.deltaBase,
            command.expectedVersion,
            command.deltaBase,
            command.locationId,
            command.inventoryPoolId,
            command.locationId,
            command.inventoryPoolId,
            command.deltaBase,
            command.expectedVersion,
            command.deltaBase,
            command.deltaBase,
          ),
        // The ledger row exists only when the guarded upsert in this same
        // transaction actually changed exactly one balance row.
        database
          .prepare(
            "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, actor_id, reason_code, metadata_json, created_at, idempotency_key) SELECT ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, 0, 'inventory_balance', ?, 'STAFF', ?, ?, '{}', ?, ? WHERE changes()=1",
          )
          .bind(
            ledgerEntryId,
            command.inventoryPoolId,
            command.locationId,
            command.deltaBase,
            balanceIdentity,
            command.actorId,
            command.reason,
            now,
            command.idempotencyKey,
          ),
        database
          .prepare(
            "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND EXISTS (SELECT 1 FROM inventory_ledger_entries WHERE idempotency_key=?)",
          )
          .bind(
            balanceIdentity,
            now,
            ADJUSTMENT_SCOPE,
            command.idempotencyKey,
            command.idempotencyKey,
          ),
      ];
      try {
        await database.batch(statements);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("UNIQUE constraint failed"))
          throw error instanceof Error ? error : new Error(message);
        const existing = await database
          .prepare(
            "SELECT request_hash, status FROM idempotency_records WHERE scope=? AND idempotency_key=?",
          )
          .bind(ADJUSTMENT_SCOPE, command.idempotencyKey)
          .first<{
            request_hash: string;
            status: InventoryAdjustmentExecution["existingStatus"];
          }>();
        return {
          ledgerEntryId,
          claimed: false,
          existingRequestHash: existing?.request_hash ?? null,
          existingStatus: existing?.status ?? null,
        };
      }
      return { ledgerEntryId, claimed: true, existingRequestHash: null, existingStatus: null };
    },
  };
}

export async function markAdjustmentFailed(
  database: D1Database,
  idempotencyKey: string,
): Promise<void> {
  await database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), ADJUSTMENT_SCOPE, idempotencyKey)
    .run();
}

export async function findLedgerEntryForKey(
  database: D1Database,
  idempotencyKey: string,
): Promise<string | null> {
  const row = await database
    .prepare("SELECT id FROM inventory_ledger_entries WHERE idempotency_key=?")
    .bind(idempotencyKey)
    .first<{ id: string }>();
  return row?.id ?? null;
}
