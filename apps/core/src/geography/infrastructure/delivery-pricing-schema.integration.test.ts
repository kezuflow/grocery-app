import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("delivery pricing schema", () => {
  it("stores versioned location/market configuration and immutable snapshots", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(delivery_fee_configuration)").all<{
      name: string;
    }>();
    expect(columns.results.map((column) => column.name)).toEqual([
      "id",
      "market_id",
      "location_id",
      "currency",
      "minimum_delivery_fee_minor",
      "per_kilometer_rate_minor",
      "status",
      "version",
      "effective_from",
      "effective_to",
      "created_at",
      "updated_at",
    ]);
    const quoteColumns = await env.DB.prepare("PRAGMA table_info(checkout_quote)").all<{
      name: string;
    }>();
    expect(quoteColumns.results.map((column) => column.name)).toContain(
      "delivery_fee_snapshot_json",
    );
    const snapshotColumns = await env.DB.prepare(
      "PRAGMA table_info(order_fulfillment_snapshot)",
    ).all<{ name: string }>();
    expect(snapshotColumns.results.map((column) => column.name)).toContain(
      "delivery_fee_snapshot_json",
    );
  });

  it("restores the canonical quote and order indexes lost by the 0021 rebuild", async () => {
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('checkout_quote','grocery_order')",
    ).all<{ name: string }>();
    expect(indexes.results.map((row) => row.name).sort()).toEqual(
      expect.arrayContaining([
        "checkout_quote_cart_idx",
        "checkout_quote_expiry_idx",
        "grocery_order_customer_idx",
        "grocery_order_payment_unique",
      ]),
    );
  });
});
