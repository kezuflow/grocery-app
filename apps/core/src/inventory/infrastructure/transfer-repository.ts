import type {
  InventoryTransferSummary,
  InventoryTransferLineView,
  InventoryTransferStatus,
  InventoryTransferOptions,
} from "@freshmarkets/contracts";

export type TransferRecord = InventoryTransferSummary & { reason: string };
export type TransferPool = {
  inventoryPoolId: string;
  productName: string;
  baseUnit: "GRAM" | "PIECE";
};
const AUTHORITY = `SELECT 1 FROM staff_identity staff
  JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id
  JOIN permission p ON p.id=rp.permission_id JOIN staff_scope scope ON scope.staff_id=staff.id
  LEFT JOIN fulfillment_location location ON location.id=?
  WHERE staff.auth_user_id=? AND staff.status='active' AND p.code=?
  AND (scope.scope_kind='global' OR (scope.scope_kind='market' AND scope.market_id=location.market_id)
    OR (scope.scope_kind='location' AND scope.location_id=location.id))`;
const SUMMARY = `SELECT t.id transferId,t.source_location_id sourceLocationId,source.name sourceLocationName,
  t.destination_location_id destinationLocationId,destination.name destinationLocationName,
  t.status,t.version,t.reason,t.created_at createdAt,t.dispatched_at dispatchedAt,
  (SELECT COUNT(*) FROM inventory_transfer_line line WHERE line.transfer_id=t.id) lineCount
  FROM inventory_transfer t JOIN fulfillment_location source ON source.id=t.source_location_id
  JOIN fulfillment_location destination ON destination.id=t.destination_location_id`;
const ROUTE = `SELECT 1 FROM fulfillment_location source JOIN fulfillment_location destination ON destination.id=?
  WHERE source.id=? AND source.status='active' AND source.purpose='CENTRAL_WAREHOUSE'
  AND destination.status='active' AND destination.purpose='CUSTOMER_FULFILLMENT'
  AND EXISTS(SELECT 1 FROM location_capability WHERE location_id=source.id AND capability='INVENTORY' AND enabled=1)
  AND EXISTS(SELECT 1 FROM location_capability WHERE location_id=source.id AND capability='RECEIVING' AND enabled=1)`;

function requiredTransferEffect(db: D1Database) {
  return db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()<>1");
}

export function createTransferRepository(db: D1Database) {
  const required = () => requiredTransferEffect(db);
  return {
    receipt(scope: string, key: string) {
      return db
        .prepare(
          "SELECT request_hash requestHash,status,result_reference resultReference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
        )
        .bind(scope, key)
        .first<{ requestHash: string; status: string; resultReference: string | null }>();
    },
    async commit(input: {
      actorUserId: string;
      scopeLocationId: string | null;
      scope: string;
      key: string;
      hash: string;
      result: string;
      now: number;
      effects: readonly D1PreparedStatement[];
      audit: D1PreparedStatement;
    }): Promise<void> {
      await db.batch([
        db
          .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (${AUTHORITY})`)
          .bind(input.scopeLocationId, input.actorUserId, "transfers.manage"),
        db
          .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,result_reference,created_at,updated_at)
          VALUES (?,?,?,'SUCCEEDED','inventory_transfer',?,?,?)`)
          .bind(input.scope, input.key, input.hash, input.result, input.now, input.now),
        required(),
        ...input.effects,
        input.audit,
        required(),
      ]);
    },
    async available(sourceLocationId: string, poolIds: readonly string[]) {
      const rows = await db
        .prepare(`SELECT inventory_pool_id inventoryPoolId,on_hand-reserved-
        COALESCE((SELECT SUM(quantity) FROM checkout_inventory_holds h WHERE h.location_id=balance.location_id AND h.inventory_pool_id=balance.inventory_pool_id AND h.status='HELD'),0) availableBase
        FROM inventory_balance balance WHERE location_id=? AND inventory_pool_id IN (${poolIds.map(() => "?").join(",")})`)
        .bind(sourceLocationId, ...poolIds)
        .all<{ inventoryPoolId: string; availableBase: number }>();
      return new Map(rows.results.map((row) => [row.inventoryPoolId, row.availableBase]));
    },
    async hasAuthority(
      actorUserId: string,
      capability: "transfers.read" | "transfers.manage",
      locationId: string | null = null,
    ): Promise<boolean> {
      return Boolean(await db.prepare(AUTHORITY).bind(locationId, actorUserId, capability).first());
    },
    async validRoute(sourceLocationId: string, destinationLocationId: string): Promise<boolean> {
      return Boolean(await db.prepare(ROUTE).bind(destinationLocationId, sourceLocationId).first());
    },
    routeGuard(sourceLocationId: string, destinationLocationId: string) {
      return db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (${ROUTE})`)
        .bind(destinationLocationId, sourceLocationId);
    },
    read(transferId: string) {
      return db.prepare(`${SUMMARY} WHERE t.id=?`).bind(transferId).first<TransferRecord>();
    },
    async lines(transferId: string): Promise<InventoryTransferLineView[]> {
      const result = await db
        .prepare(`SELECT line.id lineId,inventory_pool_id inventoryPoolId,product_name productName,
        base_unit baseUnit,quantity_base quantityBase,accepted_base acceptedBase,
        CASE WHEN transfer.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED') THEN quantity_base-accepted_base ELSE 0 END outstandingBase
        FROM inventory_transfer_line line JOIN inventory_transfer transfer ON transfer.id=line.transfer_id WHERE transfer_id=? ORDER BY line.id`)
        .bind(transferId)
        .all<InventoryTransferLineView>();
      return result.results;
    },
    async pools(ids: readonly string[]): Promise<TransferPool[]> {
      const result = await db
        .prepare(`SELECT pool.id inventoryPoolId,product.name productName,unit.canonical_base_code baseUnit
        FROM inventory_pool pool JOIN product ON product.inventory_pool_id=pool.id JOIN unit ON unit.id=pool.base_unit_id
        WHERE pool.id IN (${ids.map(() => "?").join(",")}) AND unit.canonical_base_code IN ('GRAM','PIECE')`)
        .bind(...ids)
        .all<TransferPool>();
      return result.results;
    },
    async list(input: {
      locationId?: string;
      status?: InventoryTransferStatus;
      cursor?: { createdAt: number; id: string };
      limit: number;
    }): Promise<InventoryTransferSummary[]> {
      const filters: string[] = [],
        binds: unknown[] = [];
      if (input.locationId) {
        filters.push("(t.source_location_id=? OR t.destination_location_id=?)");
        binds.push(input.locationId, input.locationId);
      }
      if (input.status) {
        filters.push("t.status=?");
        binds.push(input.status);
      }
      if (input.cursor) {
        filters.push("(t.created_at<? OR (t.created_at=? AND t.id<?))");
        binds.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.id);
      }
      const result = await db
        .prepare(
          `${SUMMARY}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY t.created_at DESC,t.id DESC LIMIT ?`,
        )
        .bind(...binds, input.limit)
        .all<TransferRecord>();
      return result.results.map(({ reason: _reason, ...summary }) => summary);
    },
    async receipts(transferId: string) {
      const result = await db
        .prepare(`SELECT id receiptId,line_id lineId,accepted_base acceptedBase,reason,received_at receivedAt
        FROM inventory_transfer_receipt WHERE transfer_id=? ORDER BY received_at DESC,id DESC LIMIT 100`)
        .bind(transferId)
        .all<{
          receiptId: string;
          lineId: string;
          acceptedBase: number;
          reason: string;
          receivedAt: number;
        }>();
      return result.results;
    },
    async options(
      sourceLocationId: string | undefined,
      query: string,
    ): Promise<InventoryTransferOptions> {
      const locations = await db
        .prepare(`SELECT id locationId,name,purpose FROM fulfillment_location
        WHERE status='active' AND purpose IN ('CENTRAL_WAREHOUSE','CUSTOMER_FULFILLMENT') ORDER BY name,id LIMIT 200`)
        .all<{ locationId: string; name: string; purpose: string }>();
      const products = sourceLocationId
        ? await db
            .prepare(`SELECT pool.id inventoryPoolId,product.name productName,
        unit.canonical_base_code baseUnit,COALESCE(balance.on_hand,0) onHandBase,COALESCE(balance.reserved,0) reservedBase,
        COALESCE((SELECT SUM(quantity) FROM checkout_inventory_holds h WHERE h.location_id=? AND h.inventory_pool_id=pool.id AND h.status='HELD'),0) heldBase
        FROM inventory_pool pool JOIN product ON product.inventory_pool_id=pool.id JOIN unit ON unit.id=pool.base_unit_id
        LEFT JOIN inventory_balance balance ON balance.inventory_pool_id=pool.id AND balance.location_id=?
        WHERE unit.canonical_base_code IN ('GRAM','PIECE') AND instr(lower(product.name),lower(?))>0 ORDER BY product.name,pool.id LIMIT 101`)
            .bind(sourceLocationId, sourceLocationId, query)
            .all<Omit<InventoryTransferOptions["products"][number], "availableBase">>()
        : null;
      return {
        sources: locations.results
          .filter((row) => row.purpose === "CENTRAL_WAREHOUSE")
          .map(({ locationId, name }) => ({ locationId, name })),
        destinations: locations.results
          .filter((row) => row.purpose === "CUSTOMER_FULFILLMENT")
          .map(({ locationId, name }) => ({ locationId, name })),
        products: (products?.results ?? []).slice(0, 100).map((row) => ({
          ...row,
          availableBase: Math.max(0, row.onHandBase - row.reservedBase - row.heldBase),
        })),
        moreProducts: (products?.results.length ?? 0) > 100,
      };
    },
    createStatements(input: {
      transferId: string;
      sourceLocationId: string;
      destinationLocationId: string;
      reason: string;
      actorUserId: string;
      now: number;
      lines: readonly (TransferPool & { lineId: string; quantityBase: number })[];
    }): D1PreparedStatement[] {
      return [
        db
          .prepare(`INSERT INTO inventory_transfer(id,source_location_id,destination_location_id,status,version,reason,created_by,created_at)
          VALUES (?,?,?,'DRAFT',1,?,?,?)`)
          .bind(
            input.transferId,
            input.sourceLocationId,
            input.destinationLocationId,
            input.reason,
            input.actorUserId,
            input.now,
          ),
        required(),
        ...input.lines.flatMap((line) => [
          db
            .prepare(`INSERT INTO inventory_transfer_line(id,transfer_id,inventory_pool_id,product_name,base_unit,quantity_base)
            SELECT ?,?,pool.id,product.name,unit.canonical_base_code,? FROM inventory_pool pool
            JOIN product ON product.inventory_pool_id=pool.id JOIN unit ON unit.id=pool.base_unit_id
            WHERE pool.id=? AND product.name=? AND unit.canonical_base_code=?`)
            .bind(
              line.lineId,
              input.transferId,
              line.quantityBase,
              line.inventoryPoolId,
              line.productName,
              line.baseUnit,
            ),
          required(),
        ]),
      ];
    },
    transitionStatements(
      transferId: string,
      before: InventoryTransferStatus,
      expectedVersion: number,
      after: InventoryTransferStatus,
      now: number,
    ): D1PreparedStatement[] {
      return [
        db
          .prepare(`UPDATE inventory_transfer SET status=?,version=version+1,
        dispatched_at=CASE WHEN ?='IN_TRANSIT' THEN ? ELSE dispatched_at END WHERE id=? AND status=? AND version=?`)
          .bind(after, after, now, transferId, before, expectedVersion),
        required(),
      ];
    },
    dispatchLineStatements(input: {
      transferId: string;
      sourceLocationId: string;
      actorUserId: string;
      now: number;
      reason: string;
      effectKey: string;
      line: InventoryTransferLineView;
    }): D1PreparedStatement[] {
      const line = input.line;
      return [
        db
          .prepare(`UPDATE inventory_balance SET on_hand=on_hand-?,version=version+1 WHERE location_id=? AND inventory_pool_id=?
          AND on_hand-reserved-?>=COALESCE((SELECT SUM(quantity) FROM checkout_inventory_holds h
            WHERE h.location_id=inventory_balance.location_id AND h.inventory_pool_id=inventory_balance.inventory_pool_id AND h.status='HELD'),0)`)
          .bind(line.quantityBase, input.sourceLocationId, line.inventoryPoolId, line.quantityBase),
        required(),
        db
          .prepare(`INSERT INTO inventory_ledger_entries(id,inventory_pool_id,location_id,movement_type,quantity_delta_base,reservation_delta_base,
          reference_type,reference_id,actor_type,actor_id,reason_code,metadata_json,created_at,idempotency_key)
          VALUES (?,?,?,'TRANSFER_DISPATCH',?,0,'inventory_transfer',?,'STAFF',?,?,'{}',?,?)`)
          .bind(
            crypto.randomUUID(),
            line.inventoryPoolId,
            input.sourceLocationId,
            -line.quantityBase,
            input.transferId,
            input.actorUserId,
            input.reason,
            input.now,
            input.effectKey,
          ),
        required(),
      ];
    },
    receiveLineStatements(input: {
      transferId: string;
      destinationLocationId: string;
      actorUserId: string;
      now: number;
      reason: string;
      effectKey: string;
      line: InventoryTransferLineView;
      acceptedBase: number;
    }): D1PreparedStatement[] {
      const line = input.line;
      return [
        db
          .prepare(`UPDATE inventory_transfer_line SET accepted_base=accepted_base+? WHERE id=? AND transfer_id=?
          AND accepted_base=? AND quantity_base-accepted_base>=?`)
          .bind(
            input.acceptedBase,
            line.lineId,
            input.transferId,
            line.acceptedBase,
            input.acceptedBase,
          ),
        required(),
        db
          .prepare(`INSERT INTO inventory_balance(location_id,inventory_pool_id,on_hand,reserved,version) VALUES (?,?,?,0,1)
          ON CONFLICT(location_id,inventory_pool_id) DO UPDATE SET on_hand=on_hand+excluded.on_hand,version=version+1
          WHERE on_hand<=9007199254740991-excluded.on_hand AND version<9007199254740991`)
          .bind(input.destinationLocationId, line.inventoryPoolId, input.acceptedBase),
        required(),
        db
          .prepare(
            `INSERT INTO inventory_transfer_receipt(id,transfer_id,line_id,accepted_base,received_by,reason,received_at,effect_key) VALUES (?,?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            input.transferId,
            line.lineId,
            input.acceptedBase,
            input.actorUserId,
            input.reason,
            input.now,
            input.effectKey,
          ),
        required(),
        db
          .prepare(`INSERT INTO inventory_ledger_entries(id,inventory_pool_id,location_id,movement_type,quantity_delta_base,reservation_delta_base,
          reference_type,reference_id,actor_type,actor_id,reason_code,metadata_json,created_at,idempotency_key)
          VALUES (?,?,?,'TRANSFER_RECEIPT',?,0,'inventory_transfer',?,'STAFF',?,?,'{}',?,?)`)
          .bind(
            crypto.randomUUID(),
            line.inventoryPoolId,
            input.destinationLocationId,
            input.acceptedBase,
            input.transferId,
            input.actorUserId,
            input.reason,
            input.now,
            input.effectKey,
          ),
        required(),
      ];
    },
  };
}
