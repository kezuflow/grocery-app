import type { OperationsCommandState, ProcurementCommandRequest } from "@freshmarkets/contracts";
import type { AppErrorCode } from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type CreateProcurementRequirementResult =
  | { ok: true; value: { id: string; status: OperationsCommandState }; requestId: string }
  | ReturnType<typeof failure>;

const SCOPE = "procurement.createRequirement";

/**
 * Aggregate one SKU's exact paid Scheduled demand without consulting physical
 * inventory, incoming stock, buffers, forecasts, or capacity. The requirement
 * and its NOT_STARTED receiving record share a stable idempotency boundary.
 */
export async function createProcurementRequirement(
  database: D1Database,
  command: ProcurementCommandRequest,
): Promise<CreateProcurementRequirementResult> {
  const idempotency = await claimCommandIdempotency(
    database,
    Date.now,
    SCOPE,
    command.idempotencyKey,
    {
      deliveryCycleId: command.deliveryCycleId,
      locationId: command.locationId,
      inventoryPoolId: command.inventoryPoolId,
      skuId: command.skuId,
      expectedVersion: command.expectedVersion,
    },
  );
  if (!idempotency.claimed) {
    if (!idempotency.existing)
      return failure("CONFLICT", "The procurement command is still processing", command.requestId);
    if (idempotency.existing.requestHash !== idempotency.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (idempotency.existing.status === "SUCCEEDED" && idempotency.existing.resultReference) {
      const prior = await database
        .prepare("SELECT status FROM procurement_requirement WHERE id=?")
        .bind(idempotency.existing.resultReference)
        .first<{ status: string }>();
      if (prior)
        return {
          ok: true as const,
          value: {
            id: idempotency.existing.resultReference,
            status: prior.status as OperationsCommandState,
          },
          requestId: command.requestId,
        };
    }
    return failure(
      "CONFLICT",
      "The original procurement command is still processing",
      command.requestId,
    );
  }
  const now = Date.now();
  const markFailed = () =>
    database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(now, SCOPE, command.idempotencyKey)
      .run();
  const totals = await database
    .prepare(`SELECT
      COUNT(*) AS demand_version,
      COALESCE(SUM(quantity_sellable), 0) AS sellable_quantity,
      COALESCE(SUM(quantity_base_total), 0) AS demand_base,
      COALESCE(SUM(shipping_weight_grams), 0) AS shipping_weight
      FROM committed_demand
      WHERE delivery_cycle_id=? AND location_id=? AND inventory_pool_id=? AND sku_id=?
        AND status='OPEN' AND demand_basis='EXACT_PAID_LINE'`)
    .bind(
      command.deliveryCycleId,
      command.locationId,
      command.inventoryPoolId,
      command.skuId,
    )
    .first<{
      demand_version: number;
      sellable_quantity: number;
      demand_base: number;
      shipping_weight: number;
    }>();
  const quantity = totals?.demand_base ?? 0;
  if (quantity === 0) {
    await markFailed();
    return failure(
      "CONFIGURATION_ERROR",
      "No procurement requirement is derived from committed demand",
      command.requestId,
    );
  }

  const sku = await database
    .prepare(
      `SELECT 1 AS found FROM sku s JOIN product p ON p.id=s.product_id
       WHERE s.id=? AND p.inventory_pool_id=?`,
    )
    .bind(command.skuId, command.inventoryPoolId)
    .first();
  if (!sku) {
    await markFailed();
    return failure(
      "VALIDATION_FAILED",
      "SKU does not belong to the supplied inventory pool",
      command.requestId,
    );
  }

  let run = await database
    .prepare(
      "SELECT id,status FROM procurement_run WHERE delivery_cycle_id=? AND destination_location_id=?",
    )
    .bind(command.deliveryCycleId, command.locationId)
    .first<{ id: string; status: string }>();
  if (!run) {
    const runId = crypto.randomUUID();
    await database
      .prepare(
        `INSERT OR IGNORE INTO procurement_run
         (id,delivery_cycle_id,destination_location_id,status,demand_version,version,created_at,updated_at)
         VALUES (?,?,?,'AGGREGATED',?,1,?,?)`,
      )
      .bind(
        runId,
        command.deliveryCycleId,
        command.locationId,
        totals?.demand_version ?? 1,
        now,
        now,
      )
      .run();
    run = await database
      .prepare(
        "SELECT id,status FROM procurement_run WHERE delivery_cycle_id=? AND destination_location_id=?",
      )
      .bind(command.deliveryCycleId, command.locationId)
      .first<{ id: string; status: string }>();
  }
  if (!run || !["DRAFT", "AGGREGATED"].includes(run.status)) {
    await markFailed();
    return failure(
      "ILLEGAL_TRANSITION",
      "Approved procurement cannot be recalculated",
      command.requestId,
    );
  }

  const active = await database
    .prepare(
      "SELECT id, status, version FROM procurement_requirement WHERE procurement_run_id=? AND sku_id=? AND status!='CLOSED' LIMIT 1",
    )
    .bind(run.id, command.skuId)
    .first<{ id: string; status: string; version: number }>();
  if (active) {
    if (active.version !== command.expectedVersion) {
      await markFailed();
      return failure(
        "STALE_VERSION",
        "Procurement requirement changed; refresh before retrying",
        command.requestId,
      );
    }
    if (active.status !== "AGGREGATED") {
      await markFailed();
      return failure(
        "ILLEGAL_TRANSITION",
        "Approved or ordered procurement cannot be recalculated",
        command.requestId,
      );
    }
    try {
      await database.batch([
        database
          .prepare(
            `UPDATE procurement_requirement SET required_quantity=?,required_base=?,
             committed_quantity_sellable=?,committed_demand_base=?,shipping_weight_grams=?,
             updated_at=?,version=version+1
             WHERE id=? AND status='AGGREGATED' AND version=?`,
          )
          .bind(
            quantity,
            quantity,
            totals?.sellable_quantity ?? 0,
            quantity,
            totals?.shipping_weight ?? 0,
            now,
            active.id,
            command.expectedVersion,
          ),
        database
          .prepare(
            "INSERT INTO admin_command_abort(id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM procurement_requirement WHERE id=? AND status='AGGREGATED' AND version=?)",
          )
          .bind(active.id, command.expectedVersion + 1),
        database
          .prepare(
            "UPDATE receiving_record SET expected_quantity=?, updated_at=?, version=version+1 WHERE procurement_requirement_id=? AND status='NOT_STARTED'",
          )
          .bind(quantity, now, active.id),
        database
          .prepare(
            "INSERT INTO admin_command_abort(id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM receiving_record WHERE procurement_requirement_id=? AND status='NOT_STARTED' AND expected_quantity=?)",
          )
          .bind(active.id, quantity),
        database
          .prepare(
            "UPDATE procurement_run SET demand_version=?,updated_at=?,version=version+1 WHERE id=? AND status IN ('DRAFT','AGGREGATED')",
          )
          .bind(totals?.demand_version ?? 1, now, run.id),
        database
          .prepare(
            "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
          )
          .bind(active.id, now, SCOPE, command.idempotencyKey, idempotency.hash),
      ]);
    } catch {
      await markFailed();
      return failure(
        "STALE_VERSION",
        "Procurement requirement changed; refresh before retrying",
        command.requestId,
      );
    }
    return {
      ok: true,
      value: { id: active.id, status: "AGGREGATED" },
      requestId: command.requestId,
    };
  }
  if (command.expectedVersion !== 0) {
    await markFailed();
    return failure(
      "STALE_VERSION",
      "Procurement requirement no longer exists; refresh before retrying",
      command.requestId,
    );
  }

  const id = crypto.randomUUID();
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO procurement_requirement
           (id,delivery_cycle_id,location_id,inventory_pool_id,required_quantity,status,version,created_at,updated_at,
            procurement_run_id,sku_id,calculation_basis,committed_quantity_sellable,
            committed_demand_base,shipping_weight_grams,required_base)
           VALUES (?,?,?,?,?,'AGGREGATED',1,?,?,?,?,'EXACT_PAID_DEMAND',?,?,?,?)`,
        )
        .bind(
          id,
          command.deliveryCycleId,
          command.locationId,
          command.inventoryPoolId,
          quantity,
          now,
          now,
          run.id,
          command.skuId,
          totals?.sellable_quantity ?? 0,
          quantity,
          totals?.shipping_weight ?? 0,
          quantity,
        ),
      database
        .prepare(
          "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 'NOT_STARTED', 1, ?, ?)",
        )
        .bind(crypto.randomUUID(), id, quantity, now, now),
      database
        .prepare(
          "UPDATE procurement_run SET status='AGGREGATED',demand_version=?,updated_at=?,version=version+1 WHERE id=? AND status IN ('DRAFT','AGGREGATED')",
        )
        .bind(totals?.demand_version ?? 1, now, run.id),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(id, now, SCOPE, command.idempotencyKey, idempotency.hash),
    ]);
  } catch (error) {
    await markFailed();
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("procurement_requirement_active_run_sku_unique") ||
      message.includes("UNIQUE")
    )
      return failure(
        "CONFLICT",
        "An active procurement requirement already exists for this context",
        command.requestId,
      );
    throw error;
  }
  return { ok: true, value: { id, status: "AGGREGATED" }, requestId: command.requestId };
}
