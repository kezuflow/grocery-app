import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
import type { DeliveryCycleState } from "./states";

export type DeliveryCycleDraft = {
  cycleId?: string;
  marketId: string;
  name: string;
  orderOpensAt: string;
  cutoffAt: string;
  procurementAt: string;
  preparationAt: string;
  pickupAt: string;
  windows: readonly { name: string; startsAt: string; endsAt: string }[];
  participation: readonly { zoneId: string; locationId: string }[];
  expectedVersion: number;
  reason: string;
};
export type AdminDeliveryCycleView = {
  cycleId: string;
  marketId: string;
  marketName: string;
  name: string;
  status: DeliveryCycleState;
  version: number;
  cancellationUnavailableReason: string | null;
  timezone: string;
  orderOpensAt: string;
  cutoffAt: string;
  procurementAt: string | null;
  preparationAt: string | null;
  pickupAt: string | null;
  windows: readonly { windowId: string; name: string; startsAt: string; endsAt: string }[];
  participation: readonly {
    zoneId: string;
    zoneName: string;
    locationId: string;
    locationName: string;
  }[];
};
export type AdminDeliveryCyclePage = {
  items: readonly AdminDeliveryCycleView[];
  markets: readonly { marketId: string; name: string; timezone: string }[];
  nextCursor: string | null;
  canManage: boolean;
};
export type AdminCycleDestinations = {
  items: readonly { zoneId: string; zoneName: string; locationId: string; locationName: string }[];
  nextCursor: string | null;
};
export type SaveAdminDeliveryCycleRequest = AuthenticatedRequest &
  DeliveryCycleDraft & { idempotencyKey: string };
export type ScheduleAdminDeliveryCycleRequest = AuthenticatedRequest & {
  cycleId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
};
export type CancelAdminDeliveryCycleRequest = AuthenticatedRequest & {
  cycleId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
};
export interface AdminDeliveryCyclesService {
  cancelAdminDeliveryCycle(
    request: CancelAdminDeliveryCycleRequest,
  ): Promise<RpcResult<AdminDeliveryCycleView>>;
  listAdminCycleDestinations(
    request: AuthenticatedRequest & { marketId: string; cursor?: string },
  ): Promise<RpcResult<AdminCycleDestinations>>;
  listAdminDeliveryCycles(
    request: AuthenticatedRequest & { cursor?: string },
  ): Promise<RpcResult<AdminDeliveryCyclePage>>;
  saveAdminDeliveryCycleDraft(
    request: SaveAdminDeliveryCycleRequest,
  ): Promise<RpcResult<AdminDeliveryCycleView>>;
  scheduleAdminDeliveryCycle(
    request: ScheduleAdminDeliveryCycleRequest,
  ): Promise<RpcResult<AdminDeliveryCycleView>>;
}
