/**
 * Procurement/receiving workbench for a location: requirement demand joined
 * to its receiving record so staff see expected vs accepted/rejected base
 * quantities and the guarded version for the next command.
 */
export type ProcurementWorkbenchItem = {
  requirementId: string;
  cycleId: string;
  locationId: string;
  inventoryPoolId: string;
  requiredQuantityBase: number;
  acceptedBase: number;
  rejectedBase: number;
  requirementStatus: string;
  requirementVersion: number;
  receivingRecordId: string | null;
  receivingStatus: string | null;
  receivingVersion: number | null;
};

export async function listProcurementQueue(
  database: D1Database,
  query: {
    locationId: string;
    cycleId?: string;
    cursorId?: string;
    limit?: number;
    receivingOnly?: boolean;
  },
): Promise<Array<ProcurementWorkbenchItem>> {
  const limit = query.limit ?? 200;
  const clauses = ["pr.location_id=?"];
  const binds: unknown[] = [query.locationId];
  if (query.cycleId) {
    clauses.push("pr.delivery_cycle_id=?");
    binds.push(query.cycleId);
  }
  if (query.cursorId) {
    clauses.push("pr.id<?");
    binds.push(query.cursorId);
  }
  if (query.receivingOnly) clauses.push("rr.id IS NOT NULL");
  const rows = await database
    .prepare(
      `SELECT pr.id AS requirement_id, pr.delivery_cycle_id, pr.location_id, pr.inventory_pool_id, pr.required_quantity, pr.status AS requirement_status, pr.version AS requirement_version, rr.id AS receiving_record_id, rr.accepted_quantity, rr.rejected_quantity, rr.status AS receiving_status, rr.version AS receiving_version FROM procurement_requirement pr LEFT JOIN receiving_record rr ON rr.procurement_requirement_id=pr.id WHERE ${clauses.join(" AND ")} ORDER BY pr.id DESC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<{
      requirement_id: string;
      delivery_cycle_id: string;
      location_id: string;
      inventory_pool_id: string;
      required_quantity: number;
      requirement_status: string;
      requirement_version: number;
      receiving_record_id: string | null;
      accepted_quantity: number | null;
      rejected_quantity: number | null;
      receiving_status: string | null;
      receiving_version: number | null;
    }>();
  return rows.results.map((r) => ({
    requirementId: r.requirement_id,
    cycleId: r.delivery_cycle_id,
    locationId: r.location_id,
    inventoryPoolId: r.inventory_pool_id,
    requiredQuantityBase: r.required_quantity,
    acceptedBase: r.accepted_quantity ?? 0,
    rejectedBase: r.rejected_quantity ?? 0,
    requirementStatus: r.requirement_status,
    requirementVersion: r.requirement_version,
    receivingRecordId: r.receiving_record_id,
    receivingStatus: r.receiving_status,
    receivingVersion: r.receiving_version,
  }));
}
