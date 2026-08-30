import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export type MembershipPriceConfigurationView = {
  priceVersionId: string;
  offerId: string;
  amountMinor: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
};

export type ServiceFeeConfigurationView = {
  configurationId: string;
  feeType: "FLAT" | "PERCENTAGE" | "MIXED";
  flatMinor: number;
  percentageBasisPoints: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  reason: string;
};

export type UpdateMembershipPriceConfigurationRequest = AuthenticatedRequest & {
  expectedVersion: number;
  amountMinor: number;
  currency: string;
  effectiveFrom: string;
  reason: string;
  idempotencyKey: string;
};

export type UpdateServiceFeeConfigurationRequest = AuthenticatedRequest & {
  expectedVersion: number;
  feeType: ServiceFeeConfigurationView["feeType"];
  flatMinor: number;
  percentageBasisPoints: number;
  currency: string;
  effectiveFrom: string;
  reason: string;
  idempotencyKey: string;
};

export interface CommerceConfigurationService {
  getMembershipPriceConfiguration(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<MembershipPriceConfigurationView>>;
  updateMembershipPriceConfiguration(
    request: UpdateMembershipPriceConfigurationRequest,
  ): Promise<RpcResult<MembershipPriceConfigurationView>>;
  getServiceFeeConfiguration(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ServiceFeeConfigurationView>>;
  updateServiceFeeConfiguration(
    request: UpdateServiceFeeConfigurationRequest,
  ): Promise<RpcResult<ServiceFeeConfigurationView>>;
}
