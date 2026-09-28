import { expect, it } from "vitest";
import {
  analyticsDimensionKeys,
  analyticsMetricCategories,
  metricDefinitionAvailabilities,
  metricDefinitionStatuses,
} from "./admin-analytics";

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
    "skuId",
  ]);
});
