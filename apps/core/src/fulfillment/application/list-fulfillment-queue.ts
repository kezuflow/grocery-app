import type {
  FulfillmentQueueFilter,
  FulfillmentQueueItem,
  OperationalOrderDetailView,
  OperationalOrderLineView,
} from "@freshmarkets/contracts";
import { fulfillmentTransitions, type StateMap } from "../../commerce/state-machines";

const NEXT_ACTION: Readonly<
  Record<string, ReadonlyArray<FulfillmentQueueItem["allowedActions"][number]>>
> = {
  NOT_STARTED: ["START_PICKING"],
  PICKING: ["MARK_READY_TO_PACK", "RECORD_SHORTAGE"],
  READY_TO_PACK: ["START_PACKING", "RECORD_SHORTAGE"],
  PACKING: ["MARK_PACKED", "RECORD_SHORTAGE"],
  PACKED: [],
  HANDED_OFF: [],
  SHORTED: ["RESUME_PICKING", "RESUME_READY_TO_PACK", "ESCALATE"],
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
  query: {
    locationId: string;
    orderId?: string;
    cycleId?: string;
    filter?: FulfillmentQueueFilter;
    cursor?: { createdAt: number; id: string };
    limit?: number;
    now?: number;
  },
): Promise<
  Array<
    Omit<FulfillmentQueueItem, "allowedActions"> & {
      cycleId: string | null;
      manualCustody: boolean;
      sortAt: number;
      operational: OperationalOrderDetailView;
    }
  >
> {
  const limit = query.limit ?? 200;
  const now = query.now ?? Date.now();
  const clauses = ["f.location_id=?"];
  const binds: unknown[] = [query.locationId];
  if (query.orderId) {
    clauses.push("f.order_id=?");
    binds.push(query.orderId);
  }
  if (query.cycleId) {
    clauses.push("o.cycle_id=?");
    binds.push(query.cycleId);
  }
  switch (query.filter ?? "ALL") {
    case "HISTORY":
      clauses.push("f.status IN ('COMPLETED','CANCELED','HANDED_OFF')");
      break;
    case "READY_FOR_DISPATCH":
      clauses.push("f.status='PACKED'");
      break;
    case "UPCOMING":
      clauses.push(
        "f.status='NOT_STARTED' AND o.fulfillment_mode='SCHEDULED' AND COALESCE(delivery_window.starts_at,0)>?",
      );
      binds.push(now);
      break;
    case "NEW":
      clauses.push(
        "f.status='NOT_STARTED' AND NOT (o.fulfillment_mode='SCHEDULED' AND COALESCE(delivery_window.starts_at,0)>?)",
      );
      binds.push(now);
      break;
    case "PREPARING":
      clauses.push("f.status NOT IN ('COMPLETED','CANCELED','HANDED_OFF','PACKED','NOT_STARTED')");
      break;
    case "ALL":
      break;
  }
  if (query.cursor) {
    clauses.push(
      "(COALESCE(o.committed_at,o.created_at)<? OR (COALESCE(o.committed_at,o.created_at)=? AND f.order_id<?))",
    );
    binds.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id);
  }
  const rows = await database
    .prepare(
      `SELECT f.order_id, f.status, f.location_id, f.version, o.cycle_id,
       o.order_number,o.fulfillment_mode,COALESCE(o.committed_at,o.created_at) sort_at,
       COALESCE(json_extract(o.address_snapshot_json,'$.recipient'),'Recipient unavailable') recipient,
       COALESCE(json_extract(o.address_snapshot_json,'$.phone'),'Phone unavailable') phone,
       cycle.name cycle_name,delivery_window.name window_name,delivery_window.starts_at,delivery_window.ends_at,delivery_window.pickup_at,delivery_window.timezone,
       job.status delivery_status,attempt.method delivery_method,
       attempt.status delivery_attempt_status,attempt.provider_status delivery_provider_status,
       EXISTS (SELECT 1 FROM delivery_provider_dispatch attempt JOIN delivery_job job ON job.id=attempt.delivery_job_id
         WHERE job.order_id=f.order_id AND attempt.method='MANUAL' AND attempt.status='ACTIVE') AS manual_custody
       FROM fulfillment_record f JOIN grocery_order o ON o.id=f.order_id
       LEFT JOIN delivery_cycle cycle ON cycle.id=o.cycle_id
       LEFT JOIN order_delivery_window_snapshot delivery_window ON delivery_window.order_id=o.id
       LEFT JOIN delivery_job job ON job.order_id=o.id
       LEFT JOIN delivery_provider_dispatch attempt ON attempt.id=(
         SELECT latest.id FROM delivery_provider_dispatch latest WHERE latest.delivery_job_id=job.id
         ORDER BY latest.attempt_sequence DESC LIMIT 1
       )
       WHERE ${clauses.join(" AND ")}
       ORDER BY COALESCE(o.committed_at,o.created_at) DESC,f.order_id DESC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<{
      order_id: string;
      status: string;
      location_id: string;
      version: number;
      cycle_id: string | null;
      manual_custody: number;
      order_number: string | null;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
      sort_at: number;
      recipient: string;
      phone: string;
      cycle_name: string | null;
      window_name: string | null;
      starts_at: number | null;
      ends_at: number | null;
      pickup_at: number | null;
      timezone: string | null;
      delivery_status: string | null;
      delivery_method: "EXTERNAL" | "MANUAL" | null;
      delivery_attempt_status: string | null;
      delivery_provider_status: string | null;
    }>();
  const orderIds = rows.results.map((row) => row.order_id);
  const lineRows = orderIds.length
    ? await database
        .prepare(`WITH requested(id) AS (SELECT value FROM json_each(?)),
          reservations AS (
            SELECT order_id,inventory_pool_id,
              MAX(status) status,SUM(CASE WHEN status IN ('RESERVED','CONSUMED') THEN quantity ELSE 0 END) quantity
            FROM inventory_reservation WHERE order_id IN (SELECT id FROM requested)
            GROUP BY order_id,inventory_pool_id
          ), lines AS (
          SELECT item.id line_id,item.order_id,'ORIGINAL' source,item.product_name_snapshot product_name,
            item.variant_name_snapshot variant_name,item.unit_snapshot unit,item.quantity,item.base_quantity,
            item.base_unit_code_snapshot base_unit,item.sku_id,
            demand.status demand_status,demand.quantity allocation,
            reservation.status reservation_status,reservation.quantity reservation_quantity,
            balance.received_base
          FROM order_item item JOIN requested ON requested.id=item.order_id
          LEFT JOIN sku ON sku.id=item.sku_id LEFT JOIN product ON product.id=sku.product_id
          LEFT JOIN committed_demand demand ON demand.order_item_id=item.id
          LEFT JOIN reservations reservation ON reservation.order_id=item.order_id
            AND reservation.inventory_pool_id=COALESCE(sku.stock_pool_id,product.inventory_pool_id)
          LEFT JOIN cycle_goods_balance balance ON balance.cycle_id=demand.delivery_cycle_id
            AND balance.location_id=demand.location_id AND balance.inventory_pool_id=demand.inventory_pool_id
          UNION ALL
          SELECT line.id,amendment.order_id,'COMMITTED_ADDITION',line.product_name_snapshot,
            line.variant_name_snapshot,line.unit_snapshot,line.quantity,line.base_quantity,
            line.base_unit_code_snapshot,line.sku_id,demand.status,demand.quantity,
            reservation.status,reservation.quantity,balance.received_base
          FROM paid_order_amendment_line line
          JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id AND amendment.status='COMMITTED'
          JOIN requested ON requested.id=amendment.order_id
          LEFT JOIN sku ON sku.id=line.sku_id LEFT JOIN product ON product.id=sku.product_id
          LEFT JOIN committed_demand demand ON demand.amendment_line_id=line.id
          LEFT JOIN reservations reservation ON reservation.order_id=amendment.order_id
            AND reservation.inventory_pool_id=COALESCE(sku.stock_pool_id,product.inventory_pool_id)
          LEFT JOIN cycle_goods_balance balance ON balance.cycle_id=demand.delivery_cycle_id
            AND balance.location_id=demand.location_id AND balance.inventory_pool_id=demand.inventory_pool_id
        ) SELECT * FROM lines ORDER BY order_id,source,line_id`)
        .bind(JSON.stringify(orderIds))
        .all<{
          line_id: string;
          order_id: string;
          source: "ORIGINAL" | "COMMITTED_ADDITION";
          product_name: string;
          variant_name: string;
          unit: string;
          quantity: number;
          base_quantity: number;
          base_unit: string | null;
          demand_status: string | null;
          allocation: number | null;
          reservation_status: string | null;
          reservation_quantity: number | null;
          received_base: number | null;
        }>()
    : { results: [] };
  const linesByOrder = new Map<string, OperationalOrderLineView[]>();
  const modeByOrder = new Map(rows.results.map((row) => [row.order_id, row.fulfillment_mode]));
  for (const line of lineRows.results) {
    const mode = modeByOrder.get(line.order_id);
    const lines = linesByOrder.get(line.order_id) ?? [];
    lines.push({
      lineId: line.line_id,
      source: line.source,
      productName: line.product_name,
      variantName: line.variant_name,
      unit: line.unit,
      quantity: line.quantity,
      baseQuantity: line.base_quantity,
      baseUnit: line.base_unit,
      goods:
        mode === "INSTANT"
          ? {
              kind: "INSTANT_RESERVATION",
              status: line.reservation_status ?? "MISSING",
              allocatedBase: line.reservation_quantity ?? 0,
              receivedBase: null,
            }
          : {
              kind: "SCHEDULED_ALLOCATION",
              status: line.demand_status ?? "MISSING",
              allocatedBase: line.allocation ?? 0,
              receivedBase: line.received_base,
            },
    });
    linesByOrder.set(line.order_id, lines);
  }
  const iso = (value: number | null) => (value === null ? null : new Date(value).toISOString());
  return rows.results.map((r) => ({
    orderId: r.order_id,
    status: r.status,
    locationId: r.location_id,
    version: r.version,
    cycleId: r.cycle_id,
    manualCustody: r.manual_custody !== 0,
    sortAt: r.sort_at,
    operational: {
      orderNumber: r.order_number ?? r.order_id,
      committedAt: new Date(r.sort_at).toISOString(),
      fulfillmentMode: r.fulfillment_mode,
      progress: ["COMPLETED", "CANCELED", "HANDED_OFF"].includes(r.status)
        ? "HISTORY"
        : r.status === "PACKED"
          ? "READY_FOR_DISPATCH"
          : r.status === "NOT_STARTED" &&
              r.fulfillment_mode === "SCHEDULED" &&
              (r.starts_at ?? 0) > now
            ? "UPCOMING"
            : r.status === "NOT_STARTED"
              ? "NEW"
              : "PREPARING",
      recipient: { name: r.recipient, phone: r.phone },
      timing: {
        cycleName: r.cycle_name,
        windowName: r.window_name,
        startsAt: iso(r.starts_at),
        endsAt: iso(r.ends_at),
        pickupAt: iso(r.pickup_at),
        timezone: r.timezone,
      },
      deliveryStatus: r.delivery_status,
      deliveryExecution:
        r.delivery_method && r.delivery_attempt_status
          ? {
              method: r.delivery_method,
              status: r.delivery_attempt_status,
              providerStatus: r.delivery_provider_status,
            }
          : null,
      blockers:
        r.status === "SHORTED" || r.status === "ESCALATED"
          ? ["Fulfillment shortage requires resolution"]
          : [],
      lines: linesByOrder.get(r.order_id) ?? [],
    },
  }));
}
