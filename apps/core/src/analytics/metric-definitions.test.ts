import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  AnalyticsDefinitionValidationError,
  listMetricDefinitions,
  parseAnalyticsDimensions,
  parseAnalyticsWindow,
  resolveMetricDefinition,
} from "./metric-definitions";

describe("Analytics metric definition registry", () => {
  it("accepts an ordered, IANA-zoned half-open reporting window", () => {
    expect(
      parseAnalyticsWindow({
        startAt: "2026-08-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
        timezone: "Asia/Manila",
      }),
    ).toEqual({
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: "2026-09-01T00:00:00.000Z",
      timezone: "Asia/Manila",
    });
  });

  it("rejects malformed, normalized-invalid, unordered, or unzoned reporting windows", () => {
    for (const window of [
      { startAt: "not-an-instant", endAt: "2026-09-01T00:00:00.000Z", timezone: "Asia/Manila" },
      {
        startAt: "2026-09-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
        timezone: "Asia/Manila",
      },
      {
        startAt: "2026-09-02T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
        timezone: "Asia/Manila",
      },
      {
        startAt: "2026-02-31T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
        timezone: "Asia/Manila",
      },
      { startAt: "2026-08-01T00:00:00.000Z", endAt: "2026-09-01T00:00:00.000Z", timezone: "PHT" },
    ]) {
      expect(() => parseAnalyticsWindow(window)).toThrow(AnalyticsDefinitionValidationError);
    }
  });

  it("accepts only bounded, closed, distinct metric dimensions", () => {
    expect(
      parseAnalyticsDimensions([
        { key: "currency", value: "PHP" },
        { key: "locationId", value: "location-cebu-central" },
      ]),
    ).toEqual([
      { key: "currency", value: "PHP" },
      { key: "locationId", value: "location-cebu-central" },
    ]);

    for (const dimensions of [
      [{ key: "unknown", value: "PHP" }],
      [{ key: "currency", value: "" }],
      [
        { key: "currency", value: "PHP" },
        { key: "currency", value: "USD" },
      ],
      [
        { key: "marketId", value: "market-1" },
        { key: "locationId", value: "location-1" },
        { key: "currency", value: "PHP" },
        { key: "baseUnit", value: "GRAM" },
        { key: "promotionId", value: "promotion-1" },
      ],
    ]) {
      expect(() => parseAnalyticsDimensions(dimensions)).toThrow(
        AnalyticsDefinitionValidationError,
      );
    }
  });

  it("publishes exactly the approved report catalog with explicit units", async () => {
    const definitions = await listMetricDefinitions(env.DB);
    expect(definitions.map((definition) => definition.code)).toEqual([
      "active_customers",
      "canceled_orders",
      "canceled_product_quantity",
      "delivered_orders",
      "delivery_charges",
      "delivery_costs",
      "discount_spend",
      "new_customers",
      "order_count",
      "paid_product_quantity",
      "promotion_redemptions",
      "received_amount",
      "refund_amount",
      "repeat_customers",
      "repeat_orders",
    ]);
    expect(definitions.every((definition) => definition.availability === "AVAILABLE")).toBe(true);
    expect(definitions.find((definition) => definition.code === "refund_amount")).toMatchObject({
      version: 3,
      valueUnit: "MINOR_UNITS",
      dimensions: ["marketId", "locationId", "currency"],
    });
    expect(
      definitions.find((definition) => definition.code === "paid_product_quantity"),
    ).toMatchObject({
      valueUnit: "SELLING_UNITS",
      dimensions: ["marketId", "locationId", "skuId"],
    });
    expect((await resolveMetricDefinition(env.DB, "order_count")).queryKey).toBe("orderCount");
  });

  it("preserves superseded formulas without applying current SQL to old versions", async () => {
    for (const [code, version] of [
      ["order_count", 1],
      ["new_customers", 1],
      ["refund_amount", 2],
      ["inventory_adjustments_shrinkage", 2],
      ["active_members", 1],
    ] as const) {
      const historical = await resolveMetricDefinition(env.DB, code, version);
      expect(historical.definition).toMatchObject({ version, availability: "UNAVAILABLE" });
      expect(historical.definition.unavailableReason).toBeTruthy();
      expect(historical.queryKey).toBeNull();
    }
    const registration = await env.DB.prepare(
      "SELECT event_time_field FROM metric_definitions WHERE code='new_customers' AND version=1",
    ).first<{ event_time_field: string }>();
    expect(registration?.event_time_field).toBe("customer_created_at");
  });

  it("retains blocked history without adding it to active reports", async () => {
    const blocked = await listMetricDefinitions(env.DB, { status: "BLOCKED" });
    expect(blocked).toHaveLength(10);
    for (const definition of blocked) {
      expect(definition.availability).toBe("UNAVAILABLE");
      expect(definition.unavailableReason).toBeTruthy();
      expect(
        (await resolveMetricDefinition(env.DB, definition.code, definition.version)).queryKey,
      ).toBeNull();
    }
    expect(await listMetricDefinitions(env.DB, { category: "MEMBERSHIPS" })).toEqual([]);
  });

  it("rejects unknown codes, versions and lifecycle filters", async () => {
    await expect(resolveMetricDefinition(env.DB, "made_up_metric")).rejects.toThrow(
      AnalyticsDefinitionValidationError,
    );
    await expect(resolveMetricDefinition(env.DB, "order_count", 99)).rejects.toThrow(
      AnalyticsDefinitionValidationError,
    );
    await expect(listMetricDefinitions(env.DB, { category: "NOT_A_CATEGORY" })).rejects.toThrow(
      AnalyticsDefinitionValidationError,
    );
    await expect(listMetricDefinitions(env.DB, { status: "UNKNOWN" })).rejects.toThrow(
      AnalyticsDefinitionValidationError,
    );
  });

  it("enforces definition immutability and one approved version per code", async () => {
    await expect(
      env.DB.prepare(
        "UPDATE metric_definitions SET display_name='Changed' WHERE code='order_count'",
      ).run(),
    ).rejects.toThrow(/immutable/i);
    await expect(
      env.DB.prepare(`INSERT INTO metric_definitions
      (id,code,version,display_name,category,formula_json,source_contract_version,event_time_field,
       reporting_timezone_policy,dimensions_json,inclusion_json,exclusion_json,rounding_policy,status,unavailable_reason,approved_at)
      SELECT 'duplicate-current-order',code,99,display_name,category,formula_json,source_contract_version,event_time_field,
       reporting_timezone_policy,dimensions_json,inclusion_json,exclusion_json,rounding_policy,'APPROVED',NULL,approved_at
      FROM metric_definitions WHERE code='order_count' AND status='APPROVED'`).run(),
    ).rejects.toThrow(/unique/i);
    await expect(
      env.DB.prepare("DELETE FROM metric_definitions WHERE code='order_count'").run(),
    ).rejects.toThrow(/immutable/i);
  });
});
