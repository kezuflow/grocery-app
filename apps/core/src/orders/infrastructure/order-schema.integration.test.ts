import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("orders snapshot integrity schema", () => {
  it("keeps grocery_order address snapshots and order_item price history intact", async () => {
    const orderCols = (
      await env.DB.prepare("PRAGMA table_info(grocery_order)").all<{ name: string }>()
    ).results.map((column) => column.name);
    expect(orderCols).toEqual(
      expect.arrayContaining(["address_snapshot_json", "total_minor", "currency"]),
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
});
