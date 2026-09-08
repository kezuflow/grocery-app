import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
export type AdminLocationFulfillmentView = {
  locationId: string;
  locationName: string;
  version: number;
  dispatchReady: boolean;
  instantPromiseMinutes: number | null;
  blockers: string[];
  canManage: boolean;
};
export type ConfigureAdminLocationFulfillmentRequest = AuthenticatedRequest & {
  locationId: string;
  expectedVersion: number;
  dispatchReady: boolean;
  instantPromiseMinutes: number | null;
  reason: string;
  idempotencyKey: string;
};
export type LocationFulfillmentService = {
  getAdminLocationFulfillment(
    request: AuthenticatedRequest & { locationId: string },
  ): Promise<RpcResult<AdminLocationFulfillmentView>>;
  configureAdminLocationFulfillment(
    request: ConfigureAdminLocationFulfillmentRequest,
  ): Promise<RpcResult<AdminLocationFulfillmentView>>;
};
