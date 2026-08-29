export type ReceivingRecordRow = {
  id: string;
  procurementRequirementId: string;
  expectedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  status: string;
  version: number;
};

export type ProcurementRequirementRow = {
  id: string;
  locationId: string;
  inventoryPoolId: string;
  requiredQuantity: number;
  status: string;
  version: number;
};

export type InventoryBalanceVersionRow = { onHand: number; reserved: number; version: number };

export type ClaimOutcome = {
  claimed: boolean;
  existingRequestHash: string | null;
  existingStatus: "PROCESSING" | "SUCCEEDED" | "FAILED" | null;
};

export const START_RECEIVING_SCOPE = "procurement.startReceiving";
export const RECORD_LINE_SCOPE = "procurement.recordReceivedLine";

export type RecordLineBatchInput = {
  receivingRecordId: string;
  procurementRequirementId: string;
  locationId: string;
  inventoryPoolId: string;
  acceptedDelta: number;
  rejectedDelta: number;
  reason: string | null;
  actorId: string;
  expectedRecordVersion: number;
  expectedRequirementVersion: number;
  nextRecordStatus: string;
  nextRequirementStatus: string;
  idempotencyKey: string;
  requestHash: string;
};

export function createReceivingRepository(database: D1Database) {
  return {
    async readRecord(receivingRecordId: string): Promise<ReceivingRecordRow | null> {
      const row = await database
        .prepare(
          "SELECT id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version FROM receiving_record WHERE id=?",
        )
        .bind(receivingRecordId)
        .first<{
          id: string;
          procurement_requirement_id: string;
          expected_quantity: number;
          accepted_quantity: number;
          rejected_quantity: number;
          status: string;
          version: number;
        }>();
      return row
        ? {
            id: row.id,
            procurementRequirementId: row.procurement_requirement_id,
            expectedQuantity: row.expected_quantity,
            acceptedQuantity: row.accepted_quantity,
            rejectedQuantity: row.rejected_quantity,
            status: row.status,
            version: row.version,
          }
        : null;
    },
    async readRecordByRequirement(
      procurementRequirementId: string,
    ): Promise<ReceivingRecordRow | null> {
      const row = await database
        .prepare(
          "SELECT id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version FROM receiving_record WHERE procurement_requirement_id=? ORDER BY rowid ASC LIMIT 1",
        )
        .bind(procurementRequirementId)
        .first<{
          id: string;
          procurement_requirement_id: string;
          expected_quantity: number;
          accepted_quantity: number;
          rejected_quantity: number;
          status: string;
          version: number;
        }>();
      return row
        ? {
            id: row.id,
            procurementRequirementId: row.procurement_requirement_id,
            expectedQuantity: row.expected_quantity,
            acceptedQuantity: row.accepted_quantity,
            rejectedQuantity: row.rejected_quantity,
            status: row.status,
            version: row.version,
          }
        : null;
    },
    async readRequirement(
      procurementRequirementId: string,
    ): Promise<ProcurementRequirementRow | null> {
      const row = await database
        .prepare(
          "SELECT id, location_id, inventory_pool_id, required_quantity, status, version FROM procurement_requirement WHERE id=?",
        )
        .bind(procurementRequirementId)
        .first<{
          id: string;
          location_id: string;
          inventory_pool_id: string;
          required_quantity: number;
          status: string;
          version: number;
        }>();
      return row
        ? {
            id: row.id,
            locationId: row.location_id,
            inventoryPoolId: row.inventory_pool_id,
            requiredQuantity: row.required_quantity,
            status: row.status,
            version: row.version,
          }
        : null;
    },
    async readInventoryBalance(
      locationId: string,
      inventoryPoolId: string,
    ): Promise<InventoryBalanceVersionRow | null> {
      const row = await database
        .prepare(
          "SELECT on_hand, reserved, version FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
        )
        .bind(locationId, inventoryPoolId)
        .first<{ on_hand: number; reserved: number; version: number }>();
      return row ? { onHand: row.on_hand, reserved: row.reserved, version: row.version } : null;
    },
    async claimIdempotency(
      scope: string,
      idempotencyKey: string,
      requestHash: string,
    ): Promise<ClaimOutcome> {
      const now = Date.now();
      try {
        await database
          .prepare(
            "INSERT INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, 'receiving_record', 'PROCESSING', ?, ?)",
          )
          .bind(scope, idempotencyKey, requestHash, now, now)
          .run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("UNIQUE constraint failed"))
          throw error instanceof Error ? error : new Error(message);
        const existing = await database
          .prepare(
            "SELECT request_hash, status FROM idempotency_records WHERE scope=? AND idempotency_key=?",
          )
          .bind(scope, idempotencyKey)
          .first<{ request_hash: string; status: ClaimOutcome["existingStatus"] }>();
        return {
          claimed: false,
          existingRequestHash: existing?.request_hash ?? null,
          existingStatus: existing?.status ?? null,
        };
      }
      return { claimed: true, existingRequestHash: null, existingStatus: null };
    },
    async startReceivingRecord(
      receivingRecordId: string,
      expectedVersion: number,
      idempotencyKey: string,
      requestHash: string,
    ): Promise<ClaimOutcome> {
      const claim = await this.claimIdempotency(START_RECEIVING_SCOPE, idempotencyKey, requestHash);
      if (!claim.claimed) return claim;
      const now = Date.now();
      await database.batch([
        database
          .prepare(
            "UPDATE receiving_record SET status='IN_PROGRESS', updated_at=?, version=version+1 WHERE id=? AND status='NOT_STARTED' AND version=?",
          )
          .bind(now, receivingRecordId, expectedVersion),
        database
          .prepare(
            "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND changes()=1",
          )
          .bind(receivingRecordId, now, START_RECEIVING_SCOPE, idempotencyKey),
      ]);
      return claim;
    },
    async recordReceivedLine(input: RecordLineBatchInput): Promise<void> {
      const now = Date.now();
      const eventId = crypto.randomUUID();
      await database.batch([
        database
          .prepare(
            "UPDATE receiving_record SET accepted_quantity=accepted_quantity+?, rejected_quantity=rejected_quantity+?, status=?, updated_at=?, version=version+1 WHERE id=? AND version=? AND status IN ('IN_PROGRESS','DISCREPANCY') AND accepted_quantity+rejected_quantity+?<=expected_quantity",
          )
          .bind(
            input.acceptedDelta,
            input.rejectedDelta,
            input.nextRecordStatus,
            now,
            input.receivingRecordId,
            input.expectedRecordVersion,
            input.acceptedDelta + input.rejectedDelta,
          ),
        database
          .prepare(
            "INSERT INTO receiving_event (id, receiving_record_id, procurement_requirement_id, location_id, inventory_pool_id, accepted_delta, rejected_delta, reason, idempotency_key, occurred_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes()=1",
          )
          .bind(
            eventId,
            input.receivingRecordId,
            input.procurementRequirementId,
            input.locationId,
            input.inventoryPoolId,
            input.acceptedDelta,
            input.rejectedDelta,
            input.reason,
            input.idempotencyKey,
            now,
          ),
        // Accepted quantity becomes usable stock only when the immutable event
        // for this command exists; rejected quantity never enters inventory.
        database
          .prepare(
            "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) SELECT ?, ?, ?, 0, 1 WHERE ?>0 AND EXISTS (SELECT 1 FROM receiving_event WHERE idempotency_key=?) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=on_hand+excluded.on_hand, version=version+1 WHERE EXISTS (SELECT 1 FROM receiving_event WHERE idempotency_key=?)",
          )
          .bind(
            input.locationId,
            input.inventoryPoolId,
            input.acceptedDelta,
            input.acceptedDelta,
            input.idempotencyKey,
            input.idempotencyKey,
          ),
        database
          .prepare(
            "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, actor_id, reason_code, metadata_json, created_at, idempotency_key) SELECT ?, ?, ?, 'RECEIVING_ACCEPTED', ?, 0, 'receiving_event', ?, 'STAFF', ?, 'PROCUREMENT_RECEIPT', ?, ?, ? WHERE changes()=1 AND ?>0",
          )
          .bind(
            crypto.randomUUID(),
            input.inventoryPoolId,
            input.locationId,
            input.acceptedDelta,
            input.receivingRecordId,
            input.actorId,
            JSON.stringify({ rejectedDelta: input.rejectedDelta, reason: input.reason }),
            now,
            input.idempotencyKey,
            input.acceptedDelta,
          ),
        database
          .prepare(
            "UPDATE procurement_requirement SET status=?, updated_at=?, version=version+1 WHERE id=? AND version=? AND status IN ('ORDERED','PARTIALLY_RECEIVED') AND EXISTS (SELECT 1 FROM receiving_event WHERE idempotency_key=?)",
          )
          .bind(
            input.nextRequirementStatus,
            now,
            input.procurementRequirementId,
            input.expectedRequirementVersion,
            input.idempotencyKey,
          ),
        database
          .prepare(
            "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND EXISTS (SELECT 1 FROM receiving_event WHERE idempotency_key=?) AND (SELECT version FROM procurement_requirement WHERE id=?)=?",
          )
          .bind(
            input.receivingRecordId,
            now,
            RECORD_LINE_SCOPE,
            input.idempotencyKey,
            input.idempotencyKey,
            input.procurementRequirementId,
            input.expectedRequirementVersion + 1,
          ),
      ]);
    },
    async markFailed(scope: string, idempotencyKey: string): Promise<void> {
      await database
        .prepare(
          "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(Date.now(), scope, idempotencyKey)
        .run();
    },
  };
}

export type ReceivingRepository = ReturnType<typeof createReceivingRepository>;
