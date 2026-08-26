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
): Promise<Array<Omit<FulfillmentQueueItem, "allowedActions">>> {
  const rows = await database
    .prepare(
      "SELECT order_id, status, location_id, version FROM fulfillment_record WHERE location_id=? AND status NOT IN ('CANCELED') ORDER BY updated_at ASC, rowid ASC LIMIT 200",
    )
    .bind(query.locationId)
    .all<{ order_id: string; status: string; location_id: string; version: number }>();
  return rows.results.map((r) => ({
    orderId: r.order_id,
    status: r.status,
    locationId: r.location_id,
    version: r.version,
  }));
}
