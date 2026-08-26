import type { OperationalExceptionItem } from "@freshmarkets/contracts";

/**
 * Derived operational exception queue for one location: shortage-flagged
 * fulfillment records, failed deliveries awaiting resolution, and receiving
 * discrepancies (rejected units or short acceptance). Read-only facts; each
 * names the guarded aggregate its resolution command must address.
 */
export async function listOperationalExceptions(
  database: D1Database,
  query: { locationId: string },
): Promise<Array<OperationalExceptionItem>> {
  const [shortagesResult, failedDeliveriesResult, discrepanciesResult] = await Promise.all([
    database
      .prepare(
        "SELECT id, order_id, status FROM fulfillment_record WHERE location_id=? AND status='SHORTAGE' ORDER BY updated_at ASC LIMIT 50",
      )
      .bind(query.locationId)
      .all<{ id: string; order_id: string; status: string }>(),
    database
      .prepare(
        "SELECT d.id, d.order_id, d.status FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id WHERE f.location_id=? AND d.status='FAILED' ORDER BY d.version ASC LIMIT 50",
      )
      .bind(query.locationId)
      .all<{ id: string; order_id: string; status: string }>(),
    database
      .prepare(
        "SELECT rr.id, rr.procurement_requirement_id, pr.location_id, rr.expected_quantity, rr.accepted_quantity, rr.rejected_quantity FROM receiving_record rr JOIN procurement_requirement pr ON pr.id=rr.procurement_requirement_id WHERE pr.location_id=? AND (rr.rejected_quantity>0 OR rr.accepted_quantity+rr.rejected_quantity NOT IN (0, rr.expected_quantity)) AND rr.status!='PENDING' ORDER BY rr.rowid DESC LIMIT 50",
      )
      .bind(query.locationId)
      .all<{
        id: string;
        procurement_requirement_id: string;
        location_id: string;
        expected_quantity: number;
        accepted_quantity: number;
        rejected_quantity: number;
      }>(),
  ]);
  const shortages = shortagesResult.results;
  const failedDeliveries = failedDeliveriesResult.results;
  const discrepancies = discrepanciesResult.results;
  return [
    ...shortages.map((r): OperationalExceptionItem => ({
      kind: "FULFILLMENT_SHORTAGE",
      referenceId: r.id,
      orderId: r.order_id,
      locationId: query.locationId,
      detail: `Fulfillment ${r.status}; resolve or restock before packing.`,
    })),
    ...failedDeliveries.map((r): OperationalExceptionItem => ({
      kind: "DELIVERY_FAILED",
      referenceId: r.id,
      orderId: r.order_id,
      locationId: query.locationId,
      detail: "Failed delivery; retry, reschedule, or escalate.",
    })),
    ...discrepancies.map((r): OperationalExceptionItem => ({
      kind: "RECEIVING_DISCREPANCY",
      referenceId: r.id,
      orderId: null,
      locationId: r.location_id,
      detail: `Expected ${r.expected_quantity}, accepted ${r.accepted_quantity}, rejected ${r.rejected_quantity}.`,
    })),
  ];
}
