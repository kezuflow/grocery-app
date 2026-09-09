import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
export type ScheduledSurplusView = {
  cycleId: string;
  cycleName: string;
  locationId: string;
  inventoryPoolId: string;
  productName: string;
  unit: string;
  availableBase: number;
  releasedBase: number;
  version: number;
  blockedReason: string | null;
};
export type ReleaseScheduledSurplusRequest = AuthenticatedRequest & {
  cycleId: string;
  locationId: string;
  inventoryPoolId: string;
  quantityBase: number;
  expectedVersion: number;
  inspected: true;
  reason: string;
  idempotencyKey: string;
};
export type ScheduledSurplusReleaseView = {
  movementId: string;
  quantityBase: number;
  version: number;
};
export interface ScheduledSurplusService {
  releaseScheduledSurplus(
    request: ReleaseScheduledSurplusRequest,
  ): Promise<RpcResult<ScheduledSurplusReleaseView>>;
}
