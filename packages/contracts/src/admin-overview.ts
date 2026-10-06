import type { AuthenticatedRequest } from "./auth";
import type {
  AdminAuditEventListItem,
  AdminContextView,
  AdminScopeOptionView,
  AdminSelectedScope,
} from "./admin-foundation";
import type { RpcResult } from "./common";
import type { OperationalExceptionItem } from "./operations";

export type AdminOverviewCard = {
  code: "OPEN_ORDERS" | "PAYMENT_ATTENTION" | "OPEN_EXCEPTIONS" | "ACTIVE_PRODUCTS";
  label: string;
  value: number | null;
  unavailableReason: string | null;
  href: string;
};

export type AdminOverviewWorkloadStage = {
  code: string;
  label: string;
  count: number;
};

export type AdminOverviewException = OperationalExceptionItem & {
  href: string;
};

export type AdminOverviewView = {
  /** Only requested by Home; the shell's notification read stays lightweight. */
  commerce?: AdminCommerceOverview | null;
  notifications: ReadonlyArray<AdminDashboardNotification>;
  generatedAt: string;
  selectedScope: AdminSelectedScope;
  timezone: string;
  cards: ReadonlyArray<AdminOverviewCard>;
  workloadStages: ReadonlyArray<AdminOverviewWorkloadStage>;
  exceptions: ReadonlyArray<AdminOverviewException>;
  recentOperations: ReadonlyArray<AdminAuditEventListItem>;
  freshness: {
    sourceWatermark: string | null;
    computedAt: string;
  };
  deniedSections: ReadonlyArray<string>;
};

export type AdminDashboardNotification = {
  id: string;
  label: string;
  orderId: string;
  orderNumber: string;
  occurredAt: string;
  href: string;
  /** Selected operational scope for the authorized destination, if needed. */
  scope: AdminSelectedScope | null;
};

export type AdminOverviewRequest = AuthenticatedRequest & {
  commercePeriod?: "7d" | "30d" | "90d";
  selectedScope: AdminSelectedScope;
  timezone: string;
};

export type AdminCommerceMetric = {
  value: number | null;
  previousValue: number | null;
  unavailableReason: string | null;
};

export type AdminCommerceOverview = {
  definitionVersion: 1;
  period: "7d" | "30d" | "90d";
  startAt: string;
  endAt: string;
  timezone: string;
  currency: "PHP";
  computedAt: string;
  revenue: AdminCommerceMetric;
  monthlyRevenue: AdminCommerceMetric;
  yearlyRevenue: AdminCommerceMetric;
  orders: AdminCommerceMetric;
  users: AdminCommerceMetric;
  userGrowth: AdminCommerceMetric;
  purchasingCustomers: AdminCommerceMetric;
  returningRate: AdminCommerceMetric;
  refunds: AdminCommerceMetric;
  series: ReadonlyArray<{
    date: string;
    receivedMinor: number | null;
    refundedMinor: number | null;
    orders: number | null;
    customers: number | null;
    returningCustomers: number | null;
    newUsers: number | null;
  }>;
  products: ReadonlyArray<{
    skuId: string;
    productName: string;
    variantName: string;
    unit: string;
    quantity: number;
    grossSalesMinor: number;
  }>;
  productsUnavailableReason: string | null;
  recentOrders: ReadonlyArray<{
    orderId: string;
    orderNumber: string | null;
    customerName: string | null;
    status: string;
    totalMinor: number;
    currency: string;
    createdAt: string;
  }>;
  recentTransactions: ReadonlyArray<{
    paymentIntentId: string;
    orderId: string | null;
    orderNumber: string | null;
    status: string;
    amountMinor: number;
    currency: string;
    confirmedAt: string;
  }>;
  deniedSections: ReadonlyArray<string>;
};

export type AdminBootstrapRequest = AuthenticatedRequest & {
  /** A browser preference only; Core proves it against current Staff scope. */
  selectedScope?: AdminSelectedScope;
  /** Used for Global overview day boundaries after IANA validation in Core. */
  timezone: string;
};

export type AdminBootstrapSelection = {
  selectedScope: AdminSelectedScope | null;
  source: "REQUESTED" | "SINGLE_ASSIGNMENT" | "SELECTION_REQUIRED";
  requestedScopeAccepted: boolean | null;
  /** Canonical Market timezone, canonical Location timezone, or validated Global request timezone. */
  timezone: string | null;
};

/** One authoritative first-render result for the Admin shell and overview. */
export type AdminBootstrapView = {
  context: AdminContextView;
  scopes: ReadonlyArray<AdminScopeOptionView>;
  selection: AdminBootstrapSelection;
  overview: AdminOverviewView | null;
};

export type AdminOverviewService = {
  getAdminBootstrap(request: AdminBootstrapRequest): Promise<RpcResult<AdminBootstrapView>>;
  getAdminOverview(request: AdminOverviewRequest): Promise<RpcResult<AdminOverviewView>>;
};
