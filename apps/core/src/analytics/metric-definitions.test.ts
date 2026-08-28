import { describe, expect, it } from "vitest";
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

  it("rejects malformed, unordered, or unzoned reporting windows", () => {
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

  it("resolves every approved metric to one closed named query key", () => {
    const definition = resolveMetricDefinition("order_count");

    expect(definition.definition).toMatchObject({
      code: "order_count",
      version: 1,
      availability: "AVAILABLE",
      unavailableReason: null,
    });
    expect(definition.queryKey).toBe("orderCount");
    expect(definition).not.toHaveProperty("formulaJson");
  });

  it("rejects unknown codes and non-approved definition versions", () => {
    expect(() => resolveMetricDefinition("made_up_metric")).toThrow(
      AnalyticsDefinitionValidationError,
    );
    expect(() => resolveMetricDefinition("order_count", 2)).toThrow(
      AnalyticsDefinitionValidationError,
    );
  });

  it("returns stable unavailable metadata for blocked metric names", () => {
    const definition = resolveMetricDefinition("gmv");

    expect(definition.definition).toMatchObject({
      code: "gmv",
      availability: "UNAVAILABLE",
      unavailableReason:
        "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
    });
    expect(definition.queryKey).toBeNull();
  });

  it("filters the closed catalog without allowing unregistered codes", () => {
    expect(
      listMetricDefinitions({ category: "ORDERS" }).map((definition) => definition.code),
    ).toEqual(expect.arrayContaining(["order_count", "cancellation_rate"]));
    expect(
      listMetricDefinitions({ status: "BLOCKED" }).map((definition) => definition.code),
    ).toEqual([
      "gmv",
      "revenue_net_sales",
      "average_order_value",
      "refund_rate",
      "trial_to_paid_conversion",
      "monthly_recurring_revenue",
      "churn",
      "promotion_redemption_rate",
      "substitution_rate",
      "inventory_turnover",
    ]);
  });
});
