import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
import type { ManageableBenefitType } from "./admin-promotions";
export const promotionMediaMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const promotionMediaMaxBytes = 5 * 1024 * 1024;
export type PromotionMediaView = {
  promotionId: string;
  mediaId: string;
  version: number;
  altText: string;
  mimeType: (typeof promotionMediaMimeTypes)[number];
  status: "active" | "inactive";
};
export type PromotionMediaSelection = { mediaId: string; version: number };
export type PromotionMediaRequest = AuthenticatedRequest & { promotionId: string };
export type PromotionMediaUploadRequest = PromotionMediaRequest & {
  bytes: ArrayBuffer;
  mimeType: (typeof promotionMediaMimeTypes)[number];
  altText: string;
  expectedMedia: PromotionMediaSelection | null;
  idempotencyKey: string;
};
export type PromotionMediaUpdateRequest = PromotionMediaRequest & {
  mediaId: string;
  expectedVersion: number;
  altText: string;
  idempotencyKey: string;
};
export type PromotionMediaRemoveRequest = Omit<PromotionMediaUpdateRequest, "altText">;
export type PromotionMediaContent = {
  bytes: ArrayBuffer;
  mimeType: (typeof promotionMediaMimeTypes)[number];
  etag: string;
};
export type PublishedPromotionMediaRequest = {
  requestId: string;
  mediaId: string;
  version: number;
};
export type PublishedPromotionCampaign = {
  promotionId: string;
  code: string;
  name: string;
  description: string;
  benefitType: ManageableBenefitType;
  discountMinor: number | null;
  percent: number | null;
  minimumMinor: number;
  maximumDiscountMinor: number | null;
  endsAt: string | null;
  image: { src: string; alt: string };
};
export type PromotionMediaService = {
  getAdminPromotionMedia(
    request: PromotionMediaRequest,
  ): Promise<RpcResult<PromotionMediaView | null>>;
  uploadAdminPromotionMedia(
    request: PromotionMediaUploadRequest,
  ): Promise<RpcResult<PromotionMediaView>>;
  updateAdminPromotionMedia(
    request: PromotionMediaUpdateRequest,
  ): Promise<RpcResult<PromotionMediaView>>;
  removeAdminPromotionMedia(
    request: PromotionMediaRemoveRequest,
  ): Promise<RpcResult<PromotionMediaView>>;
  getAdminPromotionMediaContent(
    request: PromotionMediaRequest & { mediaId: string },
  ): Promise<RpcResult<PromotionMediaContent>>;
  getPublishedPromotionMedia(
    request: PublishedPromotionMediaRequest,
  ): Promise<RpcResult<PromotionMediaContent>>;
  listPublishedPromotionCampaigns(request: {
    requestId: string;
  }): Promise<RpcResult<{ items: PublishedPromotionCampaign[] }>>;
};
