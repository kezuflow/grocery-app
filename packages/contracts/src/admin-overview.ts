import type { AuthenticatedRequest } from "./auth";
import type { AdminAuditEventListItem, AdminSelectedScope } from "./admin-foundation";
import type { RpcResult } from "./common";
import type { OperationalExceptionItem } from "./operations";

export type AdminOverviewCard = {
  code: "OPEN_ORDERS" | "ACTION_REQUIRED_PAYMENTS" | "OPEN_EXCEPTIONS" | "ACTIVE_PRODUCTS";
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

export type AdminOverviewRequest = AuthenticatedRequest & {
  selectedScope: AdminSelectedScope;
  timezone: string;
};

export type AdminOverviewService = {
  getAdminOverview(request: AdminOverviewRequest): Promise<RpcResult<AdminOverviewView>>;
};
