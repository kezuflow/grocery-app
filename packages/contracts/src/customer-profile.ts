import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

/** Language is a support preference, not a guarantee of translated content. */
export type CustomerProfileView = {
  customerId: string;
  preferredLanguage: string | null;
  promotionalEmails: boolean;
  version: number;
};
export type UpdateCustomerProfileRequest = AuthenticatedRequest & {
  preferredLanguage: string | null;
  promotionalEmails: boolean;
  expectedVersion: number;
  idempotencyKey: string;
};
export type CustomerProfileService = {
  getMyCustomerProfile(request: AuthenticatedRequest): Promise<RpcResult<CustomerProfileView>>;
  updateMyCustomerProfile(
    request: UpdateCustomerProfileRequest,
  ): Promise<RpcResult<CustomerProfileView>>;
};
