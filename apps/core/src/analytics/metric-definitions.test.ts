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

  it("resolves persisted approved definitions to one closed named query key", async () => {
    const definition = await resolveMetricDefinition(env.DB, "order_count");

    expect(definition.definition).toMatchObject({
      code: "order_count",
      version: 1,
      availability: "AVAILABLE",
      unavailableReason: null,
    });
    expect(definition.queryKey).toBe("orderCount");
    expect(definition).not.toHaveProperty("formulaJson");
  });

  it("publishes dimension-safe definitions as version 2 while preserving version 1", async () => {
    for (const code of ["refund_amount", "inventory_adjustments_shrinkage"]) {
      const current = await resolveMetricDefinition(env.DB, code);
      expect(current.definition).toMatchObject({ version: 2, availability: "AVAILABLE" });
      expect(current.queryKey).not.toBeNull();

      const historical = await resolveMetricDefinition(env.DB, code, 1);
      expect(historical.definition).toMatchObject({
        version: 1,
        availability: "UNAVAILABLE",
        unavailableReason: "Superseded by dimension-safe definition version 2.",
      });
      expect(historical.queryKey).toBeNull();
    }
  });

  it("rejects unknown codes and non-approved definition versions", async () => {
    await expect(resolveMetricDefinition(env.DB, "made_up_metric")).rejects.toThrow(
      AnalyticsDefinitionValidationError,
    );
    await expect(resolveMetricDefinition(env.DB, "order_count", 2)).rejects.toThrow(
      AnalyticsDefinitionValidationError,
    );
  });

  it("returns stable unavailable metadata for blocked persisted metric names", async () => {
    const definition = await resolveMetricDefinition(env.DB, "gmv");

    expect(definition.definition).toMatchObject({
      code: "gmv",
      availability: "UNAVAILABLE",
      unavailableReason:
        "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
    });
    expect(definition.queryKey).toBeNull();
  });

  it("loads the complete persisted catalog and rejects invalid runtime filters", async () => {
    expect(
      (await listMetricDefinitions(env.DB, { category: "ORDERS" })).map(
        (definition) => definition.code,
      ),
    ).toEqual(expect.arrayContaining(["order_count", "cancellation_rate"]));
    expect(
      (await listMetricDefinitions(env.DB, { status: "BLOCKED" })).map(
        (definition) => definition.code,
      ),
    ).toEqual([
      "average_order_value",
      "churn",
      "gmv",
      "inventory_turnover",
      "monthly_recurring_revenue",
      "promotion_redemption_rate",
      "refund_rate",
      "revenue_net_sales",
      "substitution_rate",
      "trial_to_paid_conversion",
    ]);
    await expect(
      listMetricDefinitions(env.DB, { category: "NOT_A_CATEGORY" } as never),
    ).rejects.toThrow(AnalyticsDefinitionValidationError);
    await expect(listMetricDefinitions(env.DB, { status: "UNKNOWN" } as never)).rejects.toThrow(
      AnalyticsDefinitionValidationError,
    );
  });

  it("persists exactly the approved and blocked catalog definitions with DTO fields", async () => {
    const definitions = await listMetricDefinitions(env.DB);
    expect(definitions).toHaveLength(30);
    expect(definitions.map((definition) => definition.code)).toEqual([
      "active_customers",
      "active_members",
      "average_order_value",
      "cancellation_rate",
      "churn",
      "delivery_time",
      "discount_spend",
      "fulfillment_time",
      "gmv",
      "inventory_adjustments_shrinkage",
      "inventory_turnover",
      "late_delivery_rate",
      "monthly_recurring_revenue",
      "new_customers",
      "order_count",
      "orders_per_customer",
      "out_of_stock_rate",
      "packing_time",
      "picking_time",
      "promotion_influenced_order_revenue",
      "promotion_redemption_rate",
      "promotion_redemptions",
      "refund_amount",
      "refund_rate",
      "repeat_customer_rate",
      "revenue_net_sales",
      "stockouts",
      "substitution_rate",
      "trial_to_paid_conversion",
      "trialing_members",
    ]);
    expect(definitions.find((definition) => definition.code === "gmv")).toMatchObject({
      dimensions: ["marketId", "locationId", "currency"],
      unavailableReason:
        "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
    });
    expect(definitions.find((definition) => definition.code === "order_count")).toMatchObject({
      formulaDescription: "Count Orders by first successful commitment instant.",
      dimensions: ["marketId", "locationId"],
      availability: "AVAILABLE",
    });
    expect(definitions.find((definition) => definition.code === "refund_amount")).toMatchObject({
      version: 2,
    });
    expect(
      definitions.find((definition) => definition.code === "inventory_adjustments_shrinkage"),
    ).toMatchObject({ version: 2 });
    expect(
      definitions
        .filter((definition) => definition.availability === "UNAVAILABLE")
        .map((definition) => ({ code: definition.code, reason: definition.unavailableReason })),
    ).toEqual([
      {
        code: "average_order_value",
        reason:
          "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
      },
      {
        code: "churn",
        reason:
          "Requires approved renewal, grace/dunning, fee-waiver, and effective-cancellation policy.",
      },
      {
        code: "gmv",
        reason:
          "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
      },
      {
        code: "inventory_turnover",
        reason: "Deferred until its cost and period basis is approved.",
      },
      {
        code: "monthly_recurring_revenue",
        reason:
          "Requires approved renewal, grace/dunning, fee-waiver, and effective-cancellation policy.",
      },
      {
        code: "promotion_redemption_rate",
        reason: "Requires an approved promotion-redemption denominator.",
      },
      {
        code: "refund_rate",
        reason:
          "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
      },
      {
        code: "revenue_net_sales",
        reason:
          "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
      },
      { code: "substitution_rate", reason: "Unavailable while substitutions are out of scope." },
      {
        code: "trial_to_paid_conversion",
        reason: "Requires an approved cohort and conversion-window definition.",
      },
    ]);
  });

  it("stores DTO metadata in the metric-definition table rather than the closed query registry", async () => {
    const persisted = await env.DB.prepare(
      `SELECT formula_json AS formulaJson, dimensions_json AS dimensionsJson, unavailable_reason AS unavailableReason
       FROM metric_definitions WHERE code='order_count'`,
    ).first<{ formulaJson: string; dimensionsJson: string; unavailableReason: string | null }>();
    expect(persisted).toEqual({
      formulaJson: '{"description":"Count Orders by first successful commitment instant."}',
      dimensionsJson: '["marketId","locationId"]',
      unavailableReason: null,
    });
    const columns = await env.DB.prepare("PRAGMA table_info(metric_definitions)").all<{
      name: string;
    }>();
    expect(columns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining(["formula_json", "dimensions_json", "unavailable_reason"]),
    );
  });

  it("enforces persisted metric-definition immutability and one approved version per code", async () => {
    await expect(
      env.DB.prepare(
        "UPDATE metric_definitions SET display_name='Changed' WHERE code='order_count'",
      ).run(),
    ).rejects.toThrow(/immutable/i);
    await expect(
      env.DB.prepare(
        `INSERT INTO metric_definitions (
          id, code, version, display_name, category, formula_json,
          source_contract_version, event_time_field, reporting_timezone_policy,
          dimensions_json, inclusion_json, exclusion_json, rounding_policy, status,
          unavailable_reason, approved_at
        ) SELECT
          'metric-definition-order-count-v2', code, 2, display_name, category, formula_json,
          source_contract_version, event_time_field,
          reporting_timezone_policy, dimensions_json, inclusion_json, exclusion_json,
          rounding_policy, 'APPROVED', NULL, approved_at
        FROM metric_definitions WHERE code='order_count'`,
      ).run(),
    ).rejects.toThrow(/unique/i);
    await expect(
      env.DB.prepare("DELETE FROM metric_definitions WHERE code='order_count'").run(),
    ).rejects.toThrow(/immutable/i);
  });
});
