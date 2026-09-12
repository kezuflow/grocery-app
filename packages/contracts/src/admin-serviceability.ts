import type { AuthenticatedRequest } from "./auth";
import type { Coordinate } from "./geography";
import type { RpcResult } from "./common";

export type AdminServiceAreaDefinition = {
  marketId: string;
  code: string;
  name: string;
  vertices: readonly Coordinate[];
};
export type AdminServiceAreaView = AdminServiceAreaDefinition & {
  serviceAreaId: string;
  version: number;
};
export type AdminServiceabilityRequest = AuthenticatedRequest & {
  cursor?: string;
};
export type AdminServiceabilityView = {
  nextCursor: string | null;
  areas: readonly AdminServiceAreaView[];
  markets: readonly { marketId: string; name: string }[];
  canManage: boolean;
};
export type PublishAdminServiceAreaRequest = AuthenticatedRequest &
  AdminServiceAreaDefinition & {
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
  };
export type PreviewAdminServiceabilityRequest = AuthenticatedRequest &
  Coordinate & { marketId: string };
export type AdminServiceabilityPreview = {
  serviceable: boolean;
  locationId: string | null;
  locationName: string | null;
  serviceAreaName: string | null;
  reason: string | null;
};
export type AdminServiceabilityService = {
  getAdminServiceability(
    request: AdminServiceabilityRequest,
  ): Promise<RpcResult<AdminServiceabilityView>>;
  publishAdminServiceArea(
    request: PublishAdminServiceAreaRequest,
  ): Promise<RpcResult<AdminServiceAreaView>>;
  previewAdminServiceability(
    request: PreviewAdminServiceabilityRequest,
  ): Promise<RpcResult<AdminServiceabilityPreview>>;
};
