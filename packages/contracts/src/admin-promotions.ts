import type { AuthenticatedRequest, RpcResult } from "./index";

export const promotionStatuses = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type PromotionStatus = (typeof promotionStatuses)[number];

/**
 * The order-benefit subset manageable by this admin surface. The membership
 * fee waiver stays exclusively owned by the introductory-trial authority;
 * delivery benefits arrive when the Quote path consumes them.
 */
export const manageableBenefitTypes = ["ORDER_FIXED_DISCOUNT", "ORDER_PERCENT_DISCOUNT"] as const;
export type ManageableBenefitType = (typeof manageableBenefitTypes)[number];

export const previewReasonCodes = [
  "PROMOTION_INACTIVE",
  "PROMOTION_NOT_STARTED",
  "PROMOTION_EXPIRED",
  "MINIMUM_ORDER_NOT_MET",
] as const;
export type PreviewReasonCode = (typeof previewReasonCodes)[number];

export type AdminPromotionSummary = {
  promotionId: string;
  code: string;
  name: string;
  description: string;
  status: PromotionStatus;
  benefitType: ManageableBenefitType;
  discountMinor: number | null;
  percent: number | null;
  minimumMinor: number;
  startsAt: string;
  endsAt: string | null;
  globalUsageLimit: number | null;
  perCustomerUsageLimit: number | null;
  automatic: boolean;
  priority: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminPromotionDetail = AdminPromotionSummary;

export type AdminPromotionPage = {
  items: ReadonlyArray<AdminPromotionSummary>;
  nextCursor: string | null;
};

export type AdminPromotionListRequest = AuthenticatedRequest & {
  cursor?: string;
  limit?: number;
};

export type AdminPromotionDetailRequest = AuthenticatedRequest & {
  promotionId: string;
};

export type AdminPromotionCreateRequest = AuthenticatedRequest & {
  code: string;
  name: string;
  description: string;
  benefitType: ManageableBenefitType;
  discountMinor?: number;
  percent?: number;
  minimumMinor: number;
  startsAt: string;
  endsAt?: string | null;
  globalUsageLimit?: number | null;
  perCustomerUsageLimit?: number | null;
  automatic?: boolean;
  priority?: number;
  idempotencyKey: string;
};

export type AdminPromotionUpdateRequest = AuthenticatedRequest & {
  promotionId: string;
  name: string;
  description: string;
  discountMinor?: number;
  percent?: number;
  minimumMinor: number;
  startsAt: string;
  endsAt?: string | null;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminPromotionStatusChangeRequest = AuthenticatedRequest & {
  promotionId: string;
  action: "ACTIVATE" | "DEACTIVATE" | "ARCHIVE";
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminPromotionPreviewRequest = AuthenticatedRequest & {
  promotionId: string;
  subtotalMinor: number;
};

export type AdminPromotionPreviewView = {
  eligible: boolean;
  reasonCode: PreviewReasonCode | null;
  discountMinor: number | null;
};

export type AdminPromotionGrantRequest = AuthenticatedRequest & {
  promotionId: string;
  customerId: string;
  maxRedemptions: number;
  idempotencyKey: string;
};

export type AdminPromotionGrantView = {
  grantId: string;
  promotionId: string;
  customerId: string;
  benefitType: ManageableBenefitType;
  maxRedemptions: number;
  status: string;
  createdAt: string;
};

export type AdminPromotionGrantPage = {
  items: ReadonlyArray<AdminPromotionGrantView>;
  nextCursor: string | null;
};

export type AdminPromotionRedemptionView = {
  redemptionId: string;
  customerId: string;
  benefitCode: string;
  benefitType: string;
  subjectType: string | null;
  subjectId: string | null;
  redeemedAt: string;
};

export type AdminPromotionRedemptionPage = {
  items: ReadonlyArray<AdminPromotionRedemptionView>;
  nextCursor: string | null;
};

/**
 * Controlled Promotion administration. Every method derives the caller from
 * the forwarded session and requires the named capability plus a global scope
 * in Core. Preview never mutates state; redemptions are read-only here.
 */
export type AdminPromotionsService = {
  listAdminPromotions(
    request: AdminPromotionListRequest,
  ): Promise<RpcResult<AdminPromotionPage>>;
  getAdminPromotion(
    request: AdminPromotionDetailRequest,
  ): Promise<RpcResult<AdminPromotionDetail>>;
  createAdminPromotion(
    request: AdminPromotionCreateRequest,
  ): Promise<RpcResult<AdminPromotionDetail>>;
  updateAdminPromotion(
    request: AdminPromotionUpdateRequest,
  ): Promise<RpcResult<AdminPromotionDetail>>;
  changeAdminPromotionStatus(
    request: AdminPromotionStatusChangeRequest,
  ): Promise<RpcResult<AdminPromotionDetail>>;
  previewAdminPromotion(
    request: AdminPromotionPreviewRequest,
  ): Promise<RpcResult<AdminPromotionPreviewView>>;
  grantAdminPromotion(
    request: AdminPromotionGrantRequest,
  ): Promise<RpcResult<AdminPromotionGrantView>>;
  listPromotionGrants(
    request: AdminPromotionDetailRequest & { cursor?: string; limit?: number },
  ): Promise<RpcResult<AdminPromotionGrantPage>>;
  listPromotionRedemptions(
    request: AdminPromotionDetailRequest & { cursor?: string; limit?: number },
  ): Promise<RpcResult<AdminPromotionRedemptionPage>>;
};
