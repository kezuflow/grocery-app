/**
 * Procurement/receiving workbench for a location: requirement demand joined
 * to its receiving record so staff see expected vs accepted/rejected base
 * quantities and the guarded version for the next command.
 */
export type ProcurementWorkbenchItem = {
  requirementId: string;
  locationId: string;
  inventoryPoolId: string;
  requiredQuantityBase: number;
  acceptedBase: number;
  rejectedBase: number;
  requirementStatus: string;
  receivingStatus: string | null;
  receivingVersion: number | null;
};

export async function listProcurementQueue(
  database: D1Database,
  query: { locationId: string },
): Promise<Array<ProcurementWorkbenchItem>> {
  const rows = await database
    .prepare(
      "SELECT pr.id AS requirement_id, pr.location_id, pr.inventory_pool_id, pr.required_quantity, pr.status AS requirement_status, rr.accepted_quantity, rr.rejected_quantity, rr.status AS receiving_status, rr.version AS receiving_version FROM procurement_requirement pr LEFT JOIN receiving_record rr ON rr.procurement_requirement_id=pr.id WHERE pr.location_id=? ORDER BY pr.rowid DESC LIMIT 200",
    )
    .bind(query.locationId)
    .all<{
      requirement_id: string;
      location_id: string;
      inventory_pool_id: string;
      required_quantity: number;
      requirement_status: string;
      accepted_quantity: number | null;
      rejected_quantity: number | null;
      receiving_status: string | null;
      receiving_version: number | null;
    }>();
  return rows.results.map((r) => ({
    requirementId: r.requirement_id,
    locationId: r.location_id,
    inventoryPoolId: r.inventory_pool_id,
    requiredQuantityBase: r.required_quantity,
    acceptedBase: r.accepted_quantity ?? 0,
    rejectedBase: r.rejected_quantity ?? 0,
    requirementStatus: r.requirement_status,
    receivingStatus: r.receiving_status,
    receivingVersion: r.receiving_version,
  }));
}
