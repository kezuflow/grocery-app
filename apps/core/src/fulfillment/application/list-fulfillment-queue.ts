import type { FulfillmentQueueItem } from "@freshmarkets/contracts";
import { fulfillmentTransitions, type StateMap } from "../../commerce/state-machines";

const NEXT_ACTION: Readonly<
  Record<string, ReadonlyArray<FulfillmentQueueItem["allowedActions"][number]>>
> = {
  PENDING: ["START"],
  PICKING: ["PACK", "SHORTAGE"],
  SHORTAGE: ["START"],
  PACKED: [],
};

/**
 * Legal-action derivation for a fulfillment status under the implemented
 * machine. The board filters sections by capability; actions listed here are
 * exactly the legal transitions the shipped commands accept.
 */
export function allowedFulfillmentActions(status: string): FulfillmentQueueItem["allowedActions"] {
  return NEXT_ACTION[status] ?? [];
}

export function legalFulfillmentTransitions(): StateMap {
  return fulfillmentTransitions;
}

/**
 * Location-scoped fulfillment queue ordered oldest-first so staff work
 * orders in commitment order. Rows are decision DTOs; snapshots and raw
 * persistence stay behind the context.
 */
export async function listFulfillmentQueue(
  database: D1Database,
  query: { locationId: string },
): Promise<Array<Omit<FulfillmentQueueItem, "allowedActions"> & { cycleId: string | null }>> {
  const rows = await database
    .prepare(
      "SELECT f.order_id, f.status, f.location_id, f.version, o.cycle_id FROM fulfillment_record f LEFT JOIN grocery_order o ON o.id=f.order_id WHERE f.location_id=? AND f.status NOT IN ('CANCELED') ORDER BY f.updated_at ASC, f.rowid ASC LIMIT 200",
    )
    .bind(query.locationId)
    .all<{
      order_id: string;
      status: string;
      location_id: string;
      version: number;
      cycle_id: string | null;
    }>();
  return rows.results.map((r) => ({
    orderId: r.order_id,
    status: r.status,
    locationId: r.location_id,
    version: r.version,
    cycleId: r.cycle_id,
  }));
}
