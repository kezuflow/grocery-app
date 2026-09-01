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
