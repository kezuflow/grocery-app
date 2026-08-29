import { describe, expect, it } from "vitest";
import {
  analyticsDimensionKeys,
  analyticsMetricCategories,
  metricDefinitionAvailabilities,
  metricDefinitionStatuses,
  type AnalyticsOverviewView,
  type AnalyticsWindow,
  type MetricDefinitionView,
  type MetricSeriesView,
} from "./admin-analytics";

type HasFormulaJson<T> = "formulaJson" extends keyof T ? true : false;
type HasDatabaseHandle<T> = "database" extends keyof T ? true : false;

describe("admin analytics contracts", () => {
  it("publishes closed vocabulary for availability, category, status, and dimensions", () => {
    expect(metricDefinitionAvailabilities).toEqual(["AVAILABLE", "UNAVAILABLE"]);
    expect(metricDefinitionStatuses).toEqual(["APPROVED", "BLOCKED", "SUPERSEDED"]);
    expect(analyticsMetricCategories).toEqual([
      "CUSTOMERS",
      "ORDERS",
      "MEMBERSHIPS",
      "PROMOTIONS",
      "FULFILLMENT",
      "DELIVERY",
      "INVENTORY",
      "FINANCE",
    ]);
    expect(analyticsDimensionKeys).toEqual([
      "marketId",
      "locationId",
      "currency",
      "baseUnit",
      "promotionId",
      "promotionBenefitType",
      "inventoryAdjustmentReason",
    ]);
  });

  it("keeps Analytics payloads purpose-built and infrastructure-free", () => {
    const formulaFree: HasFormulaJson<MetricDefinitionView> = false;
    const databaseFree: HasDatabaseHandle<MetricDefinitionView> = false;
    expect(formulaFree).toBe(false);
    expect(databaseFree).toBe(false);

    void ({
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: "2026-09-01T00:00:00.000Z",
      timezone: "Asia/Manila",
    } satisfies AnalyticsWindow);
    void ({
      code: "order_count",
      version: 1,
      displayName: "Order count",
      category: "ORDERS",
      formulaDescription: "Count orders by first successful commitment instant.",
      availability: "AVAILABLE",
      unavailableReason: null,
      dimensions: [],
      freshness: null,
      approvedAt: "2026-08-29T00:00:00.000Z",
    } satisfies MetricDefinitionView);
    void ({
      window: {
        startAt: "2026-08-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
        timezone: "Asia/Manila",
      },
      scope: { kind: "global" },
      definitions: [{ metricCode: "order_count", definitionVersion: 1 }],
      freshness: {
        sourceWatermark: "2026-08-31T23:59:59.000Z",
        computedAt: "2026-09-01T00:00:00.000Z",
      },
      metrics: [
        {
          metricCode: "order_count",
          definitionVersion: 1,
          availability: "AVAILABLE",
          value: 12,
          unavailableReason: null,
          dimensions: [],
        },
      ],
    } satisfies AnalyticsOverviewView);
    void ({
      metricCode: "order_count",
      definitionVersion: 1,
      window: {
        startAt: "2026-08-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
        timezone: "Asia/Manila",
      },
      dimensions: [],
      availability: "AVAILABLE",
      unavailableReason: null,
      freshness: {
        sourceWatermark: "2026-08-31T23:59:59.000Z",
        computedAt: "2026-09-01T00:00:00.000Z",
      },
      points: [{ occurredAt: "2026-08-01T00:00:00.000Z", value: 1 }],
    } satisfies MetricSeriesView);
  });
});
