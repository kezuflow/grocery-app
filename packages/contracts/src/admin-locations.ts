import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export type LocationPurpose = "CUSTOMER_FULFILLMENT" | "CENTRAL_WAREHOUSE";
export type LocationCapability =
  | "RECEIVING"
  | "INVENTORY"
  | "PROCUREMENT"
  | "PICKING"
  | "PACKING"
  | "DISPATCH";
export type LocationAddress = {
  addressLine1: string;
  addressLine2: string | null;
  barangay: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  countryCode: string;
};
export type AdminLocationDetails = {
  name: string;
  address: LocationAddress;
  latitude: number;
  longitude: number;
  capabilities: readonly LocationCapability[];
};
export type AdminLocationView = {
  locationId: string;
  marketId: string;
  marketName: string;
  currency: string;
  timezone: string;
  code: string;
  name: string;
  purpose: LocationPurpose;
  status: "active" | "inactive";
  version: number;
  address: LocationAddress | null;
  latitude: number;
  longitude: number;
  capabilities: readonly LocationCapability[];
};
export type AdminLocationsView = {
  items: readonly AdminLocationView[];
  nextCursor: string | null;
  canManage: boolean;
  markets: readonly { marketId: string; name: string; currency: string; timezone: string }[];
};
export type AdminLocationsRequest = AuthenticatedRequest & { cursor?: string };
type LocationCommand = AuthenticatedRequest & { idempotencyKey: string; reason: string };
export type CreateAdminLocationRequest = LocationCommand &
  AdminLocationDetails & {
    marketId: string;
    code: string;
    purpose: LocationPurpose;
  };
export type UpdateAdminLocationRequest = LocationCommand &
  AdminLocationDetails & {
    locationId: string;
    expectedVersion: number;
  };
export type TransitionAdminLocationRequest = LocationCommand & {
  locationId: string;
  expectedVersion: number;
  action: "ACTIVATE" | "DEACTIVATE";
};
export type AdminLocationsService = {
  listAdminLocations(request: AdminLocationsRequest): Promise<RpcResult<AdminLocationsView>>;
  createAdminLocation(request: CreateAdminLocationRequest): Promise<RpcResult<AdminLocationView>>;
  updateAdminLocation(request: UpdateAdminLocationRequest): Promise<RpcResult<AdminLocationView>>;
  transitionAdminLocation(
    request: TransitionAdminLocationRequest,
  ): Promise<RpcResult<AdminLocationView>>;
};
