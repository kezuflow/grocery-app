import type { RpcResult } from "./common";
import type { AuthenticatedRequest, Scope } from "./auth";
import type { AdminSelectedScope } from "./admin-foundation";

export const metricDefinitionAvailabilities = ["AVAILABLE", "UNAVAILABLE"] as const;
export type MetricDefinitionAvailability = (typeof metricDefinitionAvailabilities)[number];

export const metricDefinitionStatuses = ["APPROVED", "BLOCKED", "SUPERSEDED"] as const;
export type MetricDefinitionStatus = (typeof metricDefinitionStatuses)[number];

export const analyticsMetricCategories = [
  "CUSTOMERS",
  "ORDERS",
  "MEMBERSHIPS",
  "PROMOTIONS",
  "FULFILLMENT",
  "DELIVERY",
  "INVENTORY",
  "FINANCE",
] as const;
export type AnalyticsMetricCategory = (typeof analyticsMetricCategories)[number];

export const analyticsDimensionKeys = [
  "marketId",
  "locationId",
  "currency",
  "baseUnit",
  "promotionId",
  "promotionBenefitType",
  "inventoryAdjustmentReason",
] as const;
export type AnalyticsDimensionKey = (typeof analyticsDimensionKeys)[number];

/** A requested or returned metric grouping; names and values are always closed or server-derived. */
export type AnalyticsDimension = {
  key: AnalyticsDimensionKey;
  value: string;
};

/** Inclusive start and exclusive end instants interpreted in the stated IANA timezone. */
export type AnalyticsWindow = {
  startAt: string;
  endAt: string;
  timezone: string;
};

export type AnalyticsFreshness = {
  sourceWatermark: string | null;
  computedAt: string;
};

/** Published definition metadata; formula JSON and storage details never leave Core. */
export type MetricDefinitionView = {
  code: string;
  version: number;
  displayName: string;
  category: AnalyticsMetricCategory;
  formulaDescription: string;
  availability: MetricDefinitionAvailability;
  unavailableReason: string | null;
  dimensions: ReadonlyArray<AnalyticsDimensionKey>;
  freshness: AnalyticsFreshness | null;
  approvedAt: string | null;
};

export type AnalyticsDefinitionReference = {
  metricCode: string;
  definitionVersion: number;
};

export type AnalyticsMetricValue = {
  metricCode: string;
  definitionVersion: number;
  availability: MetricDefinitionAvailability;
  value: number | null;
  unavailableReason: string | null;
  dimensions: ReadonlyArray<AnalyticsDimension>;
};

export type AnalyticsOverviewView = {
  window: AnalyticsWindow;
  scope: Scope;
  definitions: ReadonlyArray<AnalyticsDefinitionReference>;
  freshness: AnalyticsFreshness;
  metrics: ReadonlyArray<AnalyticsMetricValue>;
};

export type AnalyticsSeriesPoint = {
  occurredAt: string;
  value: number | null;
};

export type MetricSeriesView = {
  metricCode: string;
  definitionVersion: number;
  window: AnalyticsWindow;
  dimensions: ReadonlyArray<AnalyticsDimension>;
  availability: MetricDefinitionAvailability;
  unavailableReason: string | null;
  freshness: AnalyticsFreshness;
  points: ReadonlyArray<AnalyticsSeriesPoint>;
};

export type ListMetricDefinitionsRequest = AuthenticatedRequest & {
  category?: AnalyticsMetricCategory;
  status?: MetricDefinitionStatus;
  scope?: AdminSelectedScope;
};

export type AnalyticsOverviewRequest = AuthenticatedRequest & {
  window: AnalyticsWindow;
  scope?: AdminSelectedScope;
  dimensions?: ReadonlyArray<AnalyticsDimension>;
};

export type MetricSeriesRequest = AuthenticatedRequest & {
  metricCode: string;
  definitionVersion?: number;
  window: AnalyticsWindow;
  scope?: AdminSelectedScope;
  dimensions?: ReadonlyArray<AnalyticsDimension>;
};

/** Read-only Analytics port; Core is responsible for authorization and scope validation. */
export type AdminAnalyticsService = {
  listMetricDefinitions(
    request: ListMetricDefinitionsRequest,
  ): Promise<RpcResult<ReadonlyArray<MetricDefinitionView>>>;
  getOverview(request: AnalyticsOverviewRequest): Promise<RpcResult<AnalyticsOverviewView>>;
  getMetric(request: MetricSeriesRequest): Promise<RpcResult<MetricSeriesView>>;
  /** Explicit Core-boundary aliases retained alongside the Admin namespace names. */
  getAnalyticsOverview(
    request: AnalyticsOverviewRequest,
  ): Promise<RpcResult<AnalyticsOverviewView>>;
  getMetricSeries(request: MetricSeriesRequest): Promise<RpcResult<MetricSeriesView>>;
};
