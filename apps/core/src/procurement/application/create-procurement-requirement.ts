import type {
  ProcurementCommandRequest,
  ProcurementRequirementView,
  AppErrorCode,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
const SCOPE = "procurement.createRequirement";
const resultSchema = z.object({
  id: z.string(),
  status: z.literal("AGGREGATED"),
  view: z.object({
    requirementId: z.string(),
    cycleId: z.string(),
    locationId: z.string(),
    inventoryPoolId: z.string(),
    skuId: z.string(),
    committedQuantitySellable: z.number().int().safe().positive(),
    shippingWeightGrams: z.number().int().safe().positive(),
    requiredQuantityBase: z.number().int().safe().positive(),
    acceptedBase: z.literal(0),
    rejectedBase: z.literal(0),
    status: z.literal("AGGREGATED"),
    version: z.number().int().safe().positive(),
  }),
});
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}
export type CreateProcurementRequirementResult =
  | { ok: true; value: z.infer<typeof resultSchema>; requestId: string }
  | ReturnType<typeof failure>;
export type ProcurementCommandPorts = {
  actorAuthUserId?: string;
  reason?: string;
  now?: () => number;
};
/** The exact demand snapshot, run, requirement, receipt, audit and result share one guarded batch. */
export async function createProcurementRequirement(
  database: D1Database,
  command: ProcurementCommandRequest,
  ports: ProcurementCommandPorts = {},
): Promise<CreateProcurementRequirementResult> {
  if (
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 0 ||
    !command.idempotencyKey.trim() ||
    command.idempotencyKey.length > 200
  )
    return failure(
      "VALIDATION_FAILED",
      "A valid expected version and stable request key are required",
      command.requestId,
    );
  const payload = {
    deliveryCycleId: command.deliveryCycleId,
    locationId: command.locationId,
    inventoryPoolId: command.inventoryPoolId,
    skuId: command.skuId,
    expectedVersion: command.expectedVersion,
  };
  const legacyHash = await requestHash(payload),
    hash = await requestHash({
      ...payload,
      actor: ports.actorAuthUserId ?? null,
      reason: ports.reason ?? null,
    });
  async function replay(): Promise<CreateProcurementRequirementResult | null> {
    const saved = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash && saved.requestHash !== legacyHash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This key belongs to different procurement details",
        command.requestId,
      );
    if (saved.status === "SUCCEEDED") {
      if (!saved.resultReference?.startsWith("{"))
        return failure(
          "CONFLICT",
          "This historical aggregation was already applied; review its requirement history",
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
  const now = ports.now?.() ?? Date.now();
  const cycle = await database
    .prepare(
      "SELECT c.version,c.cutoff_at,c.status FROM delivery_cycle c JOIN fulfillment_location location ON location.market_id=c.market_id AND location.id=? WHERE c.id=?",
    )
    .bind(command.locationId, command.deliveryCycleId)
    .first<{ version: number; cutoff_at: number; status: string }>();
  if (!cycle)
    return failure(
      "NOT_FOUND",
      "Cycle and destination must belong to the same market",
      command.requestId,
    );
  if (cycle.cutoff_at > now || ["DRAFT", "SCHEDULED", "CLOSED", "CANCELED"].includes(cycle.status))
    return failure(
      "ILLEGAL_TRANSITION",
      "Aggregate paid demand after the operational cutoff of an active cycle",
      command.requestId,
    );
  const sku = await database
    .prepare(
      "SELECT 1 found FROM sku s JOIN product p ON p.id=s.product_id WHERE s.id=? AND p.inventory_pool_id=?",
    )
    .bind(command.skuId, command.inventoryPoolId)
    .first();
  if (!sku)
    return failure(
      "VALIDATION_FAILED",
      "SKU does not belong to the supplied inventory pool",
      command.requestId,
    );
  const totalsSql = `SELECT COUNT(*) count,COALESCE(SUM(quantity_sellable),0) units,COALESCE(SUM(quantity_base_total),0) quantity,COALESCE(SUM(shipping_weight_grams),0) grams FROM committed_demand WHERE delivery_cycle_id=? AND location_id=? AND inventory_pool_id=? AND sku_id=? AND status='OPEN' AND demand_basis='EXACT_PAID_LINE'`;
  const demandBindings = [
    command.deliveryCycleId,
    command.locationId,
    command.inventoryPoolId,
    command.skuId,
  ];
  const totals = await database
    .prepare(totalsSql)
    .bind(...demandBindings)
    .first<{ count: number; units: number; quantity: number; grams: number }>();
  if (!totals || Object.values(totals).some((value) => !Number.isSafeInteger(value) || value <= 0))
    return failure(
      "CONFIGURATION_ERROR",
      "No valid exact paid demand is available for this requirement",
      command.requestId,
    );
  const run = await database
    .prepare(
      "SELECT id,status,version FROM procurement_run WHERE delivery_cycle_id=? AND destination_location_id=?",
    )
    .bind(command.deliveryCycleId, command.locationId)
    .first<{ id: string; status: string; version: number }>();
  if (run && !["DRAFT", "AGGREGATED"].includes(run.status))
    return failure(
      "ILLEGAL_TRANSITION",
      "Approved procurement cannot be recalculated",
      command.requestId,
    );
  const active = run
    ? await database
        .prepare(
          "SELECT id,status,version FROM procurement_requirement WHERE procurement_run_id=? AND sku_id=?",
        )
        .bind(run.id, command.skuId)
        .first<{ id: string; status: string; version: number }>()
    : null;
  if ((active?.version ?? 0) !== command.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Procurement requirement changed; refresh before retrying",
      command.requestId,
    );
  if (active && active.status !== "AGGREGATED")
    return failure(
      "ILLEGAL_TRANSITION",
      "Approved, ordered or closed requirements cannot be recalculated",
      command.requestId,
    );
  const receipt = active
    ? await database
        .prepare(
          "SELECT id,status,version,accepted_quantity,rejected_quantity FROM receiving_record WHERE procurement_requirement_id=? ORDER BY rowid LIMIT 1",
        )
        .bind(active.id)
        .first<{
          id: string;
          status: string;
          version: number;
          accepted_quantity: number;
          rejected_quantity: number;
        }>()
    : null;
  if (
    active &&
    (!receipt ||
      receipt.status !== "NOT_STARTED" ||
      receipt.accepted_quantity !== 0 ||
      receipt.rejected_quantity !== 0)
  )
    return failure(
      "ILLEGAL_TRANSITION",
      "Receiving has started; resolve the supply discrepancy explicitly",
      command.requestId,
    );
  const id = active?.id ?? crypto.randomUUID(),
    runId = run?.id ?? crypto.randomUUID();
  const view: ProcurementRequirementView = {
    requirementId: id,
    cycleId: command.deliveryCycleId,
    locationId: command.locationId,
    inventoryPoolId: command.inventoryPoolId,
    skuId: command.skuId,
    committedQuantitySellable: totals.units,
    shippingWeightGrams: totals.grams,
    requiredQuantityBase: totals.quantity,
    acceptedBase: 0,
    rejectedBase: 0,
    status: "AGGREGATED",
    version: command.expectedVersion + 1,
  };
  const result = resultSchema.parse({ id, status: "AGGREGATED", view });
  const statements: D1PreparedStatement[] = [];
  if (ports.actorAuthUserId)
    statements.push(
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -38 WHERE NOT EXISTS (
    SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='procurement.manage'
    JOIN staff_scope scope ON scope.staff_id=staff.id JOIN fulfillment_location location ON location.id=?
    WHERE staff.auth_user_id=? AND staff.status='active' AND (scope.scope_kind='global' OR (scope.scope_kind='market' AND scope.market_id=location.market_id) OR (scope.scope_kind='location' AND scope.location_id=location.id)))`)
        .bind(command.locationId, ports.actorAuthUserId),
    );
  statements.push(
    database
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','procurement_requirement',?,?)
      ON CONFLICT(scope,idempotency_key) DO UPDATE SET request_hash=excluded.request_hash,status='PROCESSING',result_reference=NULL,updated_at=excluded.updated_at
      WHERE idempotency_records.status IN ('FAILED','PROCESSING') AND idempotency_records.request_hash IN (?,?)`)
      .bind(SCOPE, command.idempotencyKey, hash, now, now, hash, legacyHash),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -38 WHERE changes()<>1"),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -38 WHERE NOT EXISTS (SELECT 1 FROM delivery_cycle c JOIN fulfillment_location location ON location.market_id=c.market_id AND location.id=? WHERE c.id=? AND c.version=? AND c.status=? AND c.cutoff_at=? AND c.cutoff_at<=?)",
      )
      .bind(
        command.locationId,
        command.deliveryCycleId,
        cycle.version,
        cycle.status,
        cycle.cutoff_at,
        now,
      ),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -38 WHERE NOT EXISTS (SELECT 1 FROM sku s JOIN product p ON p.id=s.product_id WHERE s.id=? AND p.inventory_pool_id=?)",
      )
      .bind(command.skuId, command.inventoryPoolId),
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -38 WHERE NOT EXISTS (SELECT 1 FROM (${totalsSql}) WHERE count=? AND units=? AND quantity=? AND grams=?)`,
      )
      .bind(...demandBindings, totals.count, totals.units, totals.quantity, totals.grams),
  );
  if (run)
    statements.push(
      database
        .prepare(
          "UPDATE procurement_run SET status='AGGREGATED',demand_version=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=? AND delivery_cycle_id=? AND destination_location_id=?",
        )
        .bind(
          totals.count,
          now,
          runId,
          run.version,
          run.status,
          command.deliveryCycleId,
          command.locationId,
        ),
    );
  else
    statements.push(
      database
        .prepare(
          "INSERT INTO procurement_run(id,delivery_cycle_id,destination_location_id,status,demand_version,version,created_at,updated_at) VALUES (?,?,?,'AGGREGATED',?,1,?,?)",
        )
        .bind(runId, command.deliveryCycleId, command.locationId, totals.count, now, now),
    );
  statements.push(
    database.prepare("INSERT INTO commitment_abort(id) SELECT -38 WHERE changes()<>1"),
  );
  if (active && receipt)
    statements.push(
      database
        .prepare(`UPDATE procurement_requirement SET required_quantity=?,required_base=?,committed_quantity_sellable=?,committed_demand_base=?,shipping_weight_grams=?,updated_at=?,version=version+1
      WHERE id=? AND status='AGGREGATED' AND version=? AND procurement_run_id=? AND sku_id=? AND inventory_pool_id=? AND delivery_cycle_id=? AND location_id=?`)
        .bind(
          totals.quantity,
          totals.quantity,
          totals.units,
          totals.quantity,
          totals.grams,
          now,
          id,
          command.expectedVersion,
          runId,
          command.skuId,
          command.inventoryPoolId,
          command.deliveryCycleId,
          command.locationId,
        ),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -38 WHERE changes()<>1"),
      database
        .prepare(
          "UPDATE receiving_record SET expected_quantity=?,version=version+1,updated_at=? WHERE id=? AND procurement_requirement_id=? AND status='NOT_STARTED' AND version=? AND accepted_quantity=0 AND rejected_quantity=0",
        )
        .bind(totals.quantity, now, receipt.id, id, receipt.version),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -38 WHERE changes()<>1"),
    );
  else
    statements.push(
      database
        .prepare(`INSERT INTO procurement_requirement(id,delivery_cycle_id,location_id,inventory_pool_id,required_quantity,status,version,created_at,updated_at,procurement_run_id,sku_id,calculation_basis,committed_quantity_sellable,committed_demand_base,shipping_weight_grams,required_base)
      VALUES (?,?,?,?,?,'AGGREGATED',1,?,?,?,?,'EXACT_PAID_DEMAND',?,?,?,?)`)
        .bind(
          id,
          command.deliveryCycleId,
          command.locationId,
          command.inventoryPoolId,
          totals.quantity,
          now,
          now,
          runId,
          command.skuId,
          totals.units,
          totals.quantity,
          totals.grams,
          totals.quantity,
        ),
      database
        .prepare(
          "INSERT INTO receiving_record(id,procurement_requirement_id,expected_quantity,accepted_quantity,rejected_quantity,status,version,created_at,updated_at) VALUES (?,?,?,0,0,'NOT_STARTED',1,?,?)",
        )
        .bind(crypto.randomUUID(), id, totals.quantity, now, now),
    );
  statements.push(
    auditEventStatement(database, {
      actorUserId: ports.actorAuthUserId ?? null,
      action: "OPERATIONS.PROCUREMENT_DEMAND_AGGREGATED",
      resourceType: "procurement_requirement",
      resourceId: id,
      locationId: command.locationId,
      reason: ports.reason ?? null,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.requestId,
      occurredAt: now,
      before: active ? { status: active.status, version: active.version } : null,
      after: view,
    }),
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(result), now, SCOPE, command.idempotencyKey, hash),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -38 WHERE changes()<>1"),
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
        "Demand, cycle, requirement or access changed; refresh and retry",
        command.requestId,
      );
    throw error;
  }
  return { ok: true, value: result, requestId: command.requestId };
}
