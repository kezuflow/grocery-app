import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export type LocationOperatingSchedule = {
  weekly: { dayOfWeek: number; opensMinute: number; closesMinute: number }[];
  closures: { startsAt: string; endsAt: string; reason: string }[];
};
export type AdminLocationScheduleView = {
  locationId: string;
  locationName: string;
  timezone: string;
  version: number;
  schedule: LocationOperatingSchedule | null;
  canManage: boolean;
};
export type SaveAdminLocationScheduleRequest = AuthenticatedRequest & {
  locationId: string;
  expectedVersion: number;
  schedule: LocationOperatingSchedule;
  reason: string;
  idempotencyKey: string;
};
export type LocationScheduleService = {
  getAdminLocationSchedule(
    request: AuthenticatedRequest & { locationId: string },
  ): Promise<RpcResult<AdminLocationScheduleView>>;
  saveAdminLocationSchedule(
    request: SaveAdminLocationScheduleRequest,
  ): Promise<RpcResult<AdminLocationScheduleView>>;
};
