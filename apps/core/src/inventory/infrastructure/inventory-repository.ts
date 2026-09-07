export type InventoryBalanceRow = { onHand: number; reserved: number; version: number };
export function createInventoryRepository(database: D1Database) {
  return {
    async readBalance(
      locationId: string,
      inventoryPoolId: string,
    ): Promise<InventoryBalanceRow | null> {
      return database
        .prepare(
          "SELECT on_hand onHand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
        )
        .bind(locationId, inventoryPoolId)
        .first<InventoryBalanceRow>();
    },
    adjustmentStatements(
      command: {
        locationId: string;
        inventoryPoolId: string;
        deltaBase: number;
        reason: string;
        actorId: string;
        expectedVersion: number;
        idempotencyKey: string;
      },
      ledgerEntryId: string,
      now: number,
    ): D1PreparedStatement[] {
      return [
        // The insert candidate must itself be structurally valid before SQLite resolves a conflict.
        // The conditional update uses the original signed delta and current holds/reservations.
        database
          .prepare(`INSERT INTO inventory_balance(location_id,inventory_pool_id,on_hand,reserved,version)
          SELECT ?,?,MAX(?,0),0,1 WHERE (?=0 AND ?>=0 AND NOT EXISTS (SELECT 1 FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?))
          OR EXISTS (SELECT 1 FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?)
          ON CONFLICT(location_id,inventory_pool_id) DO UPDATE SET on_hand=on_hand+?,version=version+1
          WHERE inventory_balance.version=? AND on_hand+?>=0 AND on_hand+?-reserved>=COALESCE(
            (SELECT SUM(quantity) FROM checkout_inventory_holds WHERE location_id=inventory_balance.location_id AND inventory_pool_id=inventory_balance.inventory_pool_id AND status='HELD'),0)`)
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
        database.prepare("INSERT INTO commitment_abort(id) SELECT -39 WHERE changes()<>1"),
        database
          .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE EXISTS (
          SELECT 1 FROM inventory_balance balance WHERE location_id=? AND inventory_pool_id=?
          AND on_hand-reserved < COALESCE((SELECT SUM(quantity) FROM checkout_inventory_holds hold
            WHERE hold.location_id=balance.location_id AND hold.inventory_pool_id=balance.inventory_pool_id AND hold.status='HELD'),0))`)
          .bind(command.locationId, command.inventoryPoolId),
        database
          .prepare(`INSERT INTO inventory_ledger_entries(id,inventory_pool_id,location_id,movement_type,quantity_delta_base,reservation_delta_base,reference_type,reference_id,actor_type,actor_id,reason_code,metadata_json,created_at,idempotency_key)
          VALUES (?,?,?,'MANUAL_ADJUSTMENT',?,0,'inventory_balance',?,'STAFF',?,?,'{}',?,?)`)
          .bind(
            ledgerEntryId,
            command.inventoryPoolId,
            command.locationId,
            command.deltaBase,
            `${command.locationId}:${command.inventoryPoolId}`,
            command.actorId,
            command.reason,
            now,
            command.idempotencyKey,
          ),
      ];
    },
  };
}
