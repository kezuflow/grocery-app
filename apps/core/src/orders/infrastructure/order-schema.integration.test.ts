import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("orders snapshot integrity schema", () => {
  it("keeps grocery_order address snapshots and order_item price history intact", async () => {
    const orderCols = (
      await env.DB.prepare("PRAGMA table_info(grocery_order)").all<{ name: string }>()
    ).results.map((column) => column.name);
    expect(orderCols).toEqual(
      expect.arrayContaining([
        "address_snapshot_json",
        "total_minor",
        "currency",
        "pre_service_fee_total_minor",
        "service_fee_configuration_id",
        "service_fee_snapshot_json",
      ]),
    );
    const itemCols = (
      await env.DB.prepare("PRAGMA table_info(order_item)").all<{ name: string }>()
    ).results.map((column) => column.name);
    expect(itemCols).toEqual(
      expect.arrayContaining([
        "product_name_snapshot",
        "variant_name_snapshot",
        "unit_snapshot",
        "unit_price_minor",
        "line_total_minor",
        "base_quantity",
      ]),
    );
  });

  it("persists one coordinated cancellation and its exact refund members", async () => {
    const cancellationColumns = (
      await env.DB.prepare("PRAGMA table_info(order_cancellation)").all<{ name: string }>()
    ).results.map((column) => column.name);
    expect(cancellationColumns).toEqual(
      expect.arrayContaining([
        "order_id",
        "actor_type",
        "cause",
        "status",
        "retained_service_fee_minor",
        "required_refund_minor",
      ]),
    );
    const memberColumns = (
      await env.DB.prepare("PRAGMA table_info(order_cancellation_refund_member)").all<{
        name: string;
      }>()
    ).results.map((column) => column.name);
    expect(memberColumns).toEqual(
      expect.arrayContaining([
        "cancellation_id",
        "payment_intent_id",
        "required_amount_minor",
        "refund_id",
        "status",
      ]),
    );
  });
});
