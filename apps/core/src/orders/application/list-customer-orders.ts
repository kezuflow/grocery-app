import {
  customerOrderHistoryStates,
  type CustomerOrdersPage,
  type ListCustomerOrdersRequest,
  type RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";

const cursorSchema = z.object({
  version: z.literal(1),
  customerId: z.string(),
  filter: z.enum(["all", "active", "completed"]),
  committedAt: z.number().int().safe(),
  id: z.string().min(1).max(200),
});

/**
 * Customer order-history list read model. Historical rows are snapshots;
 * this query never joins live catalog or address state.
 */
export async function listCustomerOrders(
  database: D1Database,
  query: { customerId: string; requestId: string } & Pick<
    ListCustomerOrdersRequest,
    "cursor" | "limit" | "filter"
  >,
): Promise<RpcResult<CustomerOrdersPage>> {
  const limit = query.limit ?? 25;
  const filter = query.filter ?? "all";
  let cursor: z.infer<typeof cursorSchema> | null = null;
  try {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit");
    if (query.cursor !== undefined) {
      cursor = cursorSchema.parse(JSON.parse(query.cursor));
      if (cursor.customerId !== query.customerId || cursor.filter !== filter)
        throw new Error("Invalid cursor context");
    }
  } catch {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid order history page",
        requestId: query.requestId,
      },
    };
  }
  const predicates = ["o.customer_id=?"];
  const bindings: (string | number)[] = [query.customerId];
  if (filter !== "all")
    predicates.push(
      `o.status ${filter === "active" ? "NOT IN" : "IN"} ('DELIVERED','CANCELED','REFUNDED')`,
    );
  if (cursor) {
    predicates.push("(COALESCE(o.committed_at,o.created_at),o.id) < (?,?)");
    bindings.push(cursor.committedAt, cursor.id);
  }
  const rows = await database
    .prepare(
      `SELECT o.id,o.order_number,o.status,o.fulfillment_mode,
              ofs.delivery_date,ofs.promised_at,COALESCE(o.committed_at,o.created_at) committed_at,
              o.total_minor,o.currency,
              (SELECT COUNT(*) FROM order_item oi WHERE oi.order_id=o.id) item_count
       FROM grocery_order o
       LEFT JOIN order_fulfillment_snapshot ofs ON ofs.order_id=o.id
       WHERE ${predicates.join(" AND ")} ORDER BY committed_at DESC,o.id DESC LIMIT ?`,
    )
    .bind(...bindings, limit + 1)
    .all<{
      id: string;
      order_number: string | null;
      status: string;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
      delivery_date: number | null;
      promised_at: number | null;
      committed_at: number;
      total_minor: number;
      currency: string;
      item_count: number;
    }>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return {
    ok: true as const,
    value: {
      items: page.map((r) => ({
        id: r.id,
        orderNumber: r.order_number ?? r.id,
        status: z.enum(customerOrderHistoryStates).parse(r.status),
        fulfillmentMode: r.fulfillment_mode,
        deliveryDate: r.delivery_date === null ? null : new Date(r.delivery_date).toISOString(),
        promisedAt: r.promised_at === null ? null : new Date(r.promised_at).toISOString(),
        committedAt: new Date(r.committed_at).toISOString(),
        totalMinor: r.total_minor,
        currency: r.currency,
        itemCount: r.item_count,
      })),
      nextCursor:
        rows.results.length > limit && last
          ? JSON.stringify({
              version: 1,
              customerId: query.customerId,
              filter,
              committedAt: last.committed_at,
              id: last.id,
            })
          : null,
    },
    requestId: query.requestId,
  };
}
