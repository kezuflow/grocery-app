import type { OperationalExceptionItem } from "@freshmarkets/contracts";

export type OperationalExceptionProjection = OperationalExceptionItem & { queueKey: string };

function ageMinutes(at: number | null, now: number): number | null {
  if (at === null || !Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / 60_000));
}

function severity(quantity: number): OperationalExceptionItem["severity"] {
  if (quantity >= 1000) return "CRITICAL";
  if (quantity > 0) return "HIGH";
  return "MEDIUM";
}

type ExceptionRow = {
  source: "PROCUREMENT" | "RECEIVING" | "FULFILLMENT" | "DELIVERY";
  referenceId: string;
  orderId: string | null;
  locationId: string;
  reason: string;
  affectedQuantity: number | null;
  expectedQuantity: number | null;
  acceptedQuantity: number | null;
  rejectedQuantity: number | null;
  ownerId: string | null;
  occurredAt: number;
  recordStatus: string | null;
  queueKey: string;
};

/** One bounded set-based exception projection across any authorized location set. */
export async function listOperationalExceptionsForLocations(
  database: D1Database,
  query: { locationIds: ReadonlyArray<string>; cursorKey?: string; limit?: number },
): Promise<Array<OperationalExceptionProjection>> {
  if (query.locationIds.length === 0) return [];
  const now = Date.now();
  const rows = await database
    .prepare(
      `WITH selected_locations(location_id) AS (
         SELECT value FROM json_each(?)
       ), exception_rows AS (
         SELECT 'PROCUREMENT' AS source, se.id AS referenceId, NULL AS orderId,
                pr.location_id AS locationId, se.kind AS reason,
                se.affected_quantity AS affectedQuantity,
                NULL AS expectedQuantity, NULL AS acceptedQuantity, NULL AS rejectedQuantity,
                NULL AS ownerId, se.created_at AS occurredAt, NULL AS recordStatus
         FROM supply_exception se
         JOIN procurement_requirement pr ON pr.id=se.requirement_id
         JOIN selected_locations sl ON sl.location_id=pr.location_id
         WHERE se.status NOT IN ('RESOLVED','CLOSED')
         UNION ALL
         SELECT 'FULFILLMENT', f.id, f.order_id, f.location_id, 'FULFILLMENT_SHORTAGE',
                NULL, NULL, NULL, NULL, NULL, f.updated_at, f.status
         FROM fulfillment_record f
         JOIN selected_locations sl ON sl.location_id=f.location_id
         WHERE f.status='SHORTED'
         UNION ALL
         SELECT 'DELIVERY', d.id, d.order_id, f.location_id, 'DELIVERY_FAILED',
                NULL, NULL, NULL, NULL, d.rider_user_id, d.updated_at, d.status
         FROM delivery_job d
         JOIN fulfillment_record f ON f.order_id=d.order_id
         JOIN selected_locations sl ON sl.location_id=f.location_id
         WHERE d.status='FAILED'
         UNION ALL
         SELECT 'RECEIVING', rr.id, NULL, pr.location_id, 'RECEIVING_DISCREPANCY',
                NULL, rr.expected_quantity, rr.accepted_quantity, rr.rejected_quantity,
                NULL, rr.updated_at, rr.status
         FROM receiving_record rr
         JOIN procurement_requirement pr ON pr.id=rr.procurement_requirement_id
         JOIN selected_locations sl ON sl.location_id=pr.location_id
         WHERE (rr.rejected_quantity>0
                OR rr.accepted_quantity+rr.rejected_quantity NOT IN (0, rr.expected_quantity))
           AND rr.status!='NOT_STARTED'
       ), keyed AS (
         SELECT *, printf('%013d', occurredAt)||':'||source||':'||referenceId AS queueKey
         FROM exception_rows
       )
       SELECT * FROM keyed
       WHERE (? IS NULL OR queueKey < ?)
       ORDER BY queueKey DESC
       LIMIT ?`,
    )
    .bind(
      JSON.stringify([...new Set(query.locationIds)]),
      query.cursorKey ?? null,
      query.cursorKey ?? null,
      query.limit ?? 51,
    )
    .all<ExceptionRow>();

  return rows.results.map((row): OperationalExceptionProjection => {
    if (row.source === "PROCUREMENT") {
      const affectedQuantity = row.affectedQuantity ?? 0;
      return {
        kind: "PROCUREMENT_SHORTAGE",
        source: row.source,
        severity: severity(affectedQuantity),
        ageMinutes: ageMinutes(row.occurredAt, now),
        ownerId: null,
        referenceId: row.referenceId,
        orderId: null,
        locationId: row.locationId,
        reason: row.reason,
        permittedActions: [],
        queueKey: row.queueKey,
        detail: `Procurement shortage (${row.reason}); ${affectedQuantity} base units affected.`,
      };
    }
    if (row.source === "RECEIVING") {
      const expected = row.expectedQuantity ?? 0;
      const accepted = row.acceptedQuantity ?? 0;
      const rejected = row.rejectedQuantity ?? 0;
      return {
        kind: "RECEIVING_DISCREPANCY",
        source: row.source,
        severity: rejected > 0 ? "HIGH" : "MEDIUM",
        ageMinutes: ageMinutes(row.occurredAt, now),
        ownerId: null,
        referenceId: row.referenceId,
        orderId: null,
        locationId: row.locationId,
        reason: row.reason,
        permittedActions: [],
        queueKey: row.queueKey,
        detail: `Expected ${expected}, accepted ${accepted}, rejected ${rejected}.`,
      };
    }
    if (row.source === "FULFILLMENT") {
      return {
        kind: "FULFILLMENT_SHORTAGE",
        source: row.source,
        severity: "HIGH",
        ageMinutes: ageMinutes(row.occurredAt, now),
        ownerId: null,
        referenceId: row.referenceId,
        orderId: row.orderId,
        locationId: row.locationId,
        reason: row.reason,
        permittedActions: ["RETRY_FULFILLMENT"],
        queueKey: row.queueKey,
        detail: `Fulfillment ${row.recordStatus ?? "SHORTED"}; resolve or restock before packing.`,
      };
    }
    return {
      kind: "DELIVERY_FAILED",
      source: row.source,
      severity: "HIGH",
      ageMinutes: ageMinutes(row.occurredAt, now),
      ownerId: row.ownerId,
      referenceId: row.referenceId,
      orderId: row.orderId,
      locationId: row.locationId,
      reason: row.reason,
      permittedActions: ["RETRY_DELIVERY", "ESCALATE"],
      queueKey: row.queueKey,
      detail: "Failed delivery; retry from the delivery queue.",
    };
  });
}

/** Single-location compatibility wrapper over the set-based projection. */
export function listOperationalExceptions(
  database: D1Database,
  query: { locationId: string; cursorKey?: string; limit?: number },
): Promise<Array<OperationalExceptionProjection>> {
  return listOperationalExceptionsForLocations(database, {
    locationIds: [query.locationId],
    ...(query.cursorKey === undefined ? {} : { cursorKey: query.cursorKey }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  });
}
