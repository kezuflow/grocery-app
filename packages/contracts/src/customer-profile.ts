import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

/** Language is a support preference, not a guarantee of translated content. */
export type CustomerProfileView = {
  customerId: string;
  accountPhone: string | null;
  defaultAddressId: string | null;
  preferredLanguage: string | null;
  promotionalEmails: boolean;
  version: number;
};
export type UpdateCustomerProfileRequest = AuthenticatedRequest & {
  /** Omission preserves the stored phone for retained preference commands. */
  accountPhone?: string | null;
  preferredLanguage: string | null;
  promotionalEmails: boolean;
  expectedVersion: number;
  idempotencyKey: string;
};
export type ManageCustomerAddressRequest = AuthenticatedRequest & {
  action: "SET_DEFAULT" | "REMOVE";
  addressId: string;
  expectedAddressVersion: number;
  expectedVersion: number;
  idempotencyKey: string;
};
export type ManagedCustomerAddress = {
  addressId: string;
  addressVersion: number;
  status: "active" | "disabled";
  profile: CustomerProfileView;
};
export type CustomerProfileService = {
  getMyCustomerProfile(request: AuthenticatedRequest): Promise<RpcResult<CustomerProfileView>>;
  updateMyCustomerProfile(
    request: UpdateCustomerProfileRequest,
  ): Promise<RpcResult<CustomerProfileView>>;
  manageMyCustomerAddress(
    request: ManageCustomerAddressRequest,
  ): Promise<RpcResult<ManagedCustomerAddress>>;
};
