import type { FulfillmentQueueItem } from "@freshmarkets/contracts";
import { fulfillmentTransitions, type StateMap } from "../../commerce/state-machines";

const NEXT_ACTION: Readonly<
  Record<string, ReadonlyArray<FulfillmentQueueItem["allowedActions"][number]>>
> = {
  NOT_STARTED: ["START_PICKING"],
  PICKING: ["MARK_READY_TO_PACK", "RECORD_SHORTAGE"],
  READY_TO_PACK: ["START_PACKING", "RECORD_SHORTAGE"],
  PACKING: ["MARK_PACKED", "RECORD_SHORTAGE"],
  PACKED: ["HAND_OFF"],
  HANDED_OFF: ["COMPLETE"],
  SHORTED: ["RESUME_PICKING", "RESUME_READY_TO_PACK", "CANCEL", "ESCALATE"],
  COMPLETED: [],
  CANCELED: [],
  ESCALATED: [],
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
  query: { locationId: string; cycleId?: string; cursorId?: string; limit?: number },
): Promise<Array<Omit<FulfillmentQueueItem, "allowedActions"> & { cycleId: string | null }>> {
  const limit = query.limit ?? 200;
  const clauses = ["f.location_id=?", "f.status NOT IN ('CANCELED','COMPLETED')"];
  const binds: unknown[] = [query.locationId];
  if (query.cycleId) {
    clauses.push("o.cycle_id=?");
    binds.push(query.cycleId);
  }
  if (query.cursorId) {
    clauses.push("f.order_id<?");
    binds.push(query.cursorId);
  }
  const rows = await database
    .prepare(
      `SELECT f.order_id, f.status, f.location_id, f.version, o.cycle_id FROM fulfillment_record f LEFT JOIN grocery_order o ON o.id=f.order_id WHERE ${clauses.join(" AND ")} ORDER BY f.order_id DESC LIMIT ?`,
    )
    .bind(...binds, limit)
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
