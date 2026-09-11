import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export const bannerMediaMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const bannerMediaMaxBytes = 5 * 1024 * 1024;
export type BannerMediaView = {
  bannerId: string;
  mediaId: string;
  version: number;
  altText: string;
  mimeType: (typeof bannerMediaMimeTypes)[number];
  status: "active" | "inactive";
};
export type BannerMediaSelection = { mediaId: string; version: number };
export type BannerMediaRequest = AuthenticatedRequest & { bannerId: string };
export type BannerMediaUploadRequest = BannerMediaRequest & {
  bytes: ArrayBuffer;
  mimeType: (typeof bannerMediaMimeTypes)[number];
  altText: string;
  expectedMedia: BannerMediaSelection | null;
  idempotencyKey: string;
};
export type BannerMediaUpdateRequest = BannerMediaRequest & {
  mediaId: string;
  expectedVersion: number;
  altText: string;
  idempotencyKey: string;
};
export type BannerMediaRemoveRequest = Omit<BannerMediaUpdateRequest, "altText">;
export type BannerMediaContent = {
  bytes: ArrayBuffer;
  mimeType: (typeof bannerMediaMimeTypes)[number];
  etag: string;
};
export type PublishedBannerMediaRequest = {
  requestId: string;
  mediaId: string;
  version: number;
};
export type PublishedBanner = {
  bannerId: string;
  name: string;
  href: string | null;
  image: { src: string; alt: string };
};
export type BannerMediaService = {
  getAdminBannerMedia(request: BannerMediaRequest): Promise<RpcResult<BannerMediaView | null>>;
  uploadAdminBannerMedia(request: BannerMediaUploadRequest): Promise<RpcResult<BannerMediaView>>;
  updateAdminBannerMedia(request: BannerMediaUpdateRequest): Promise<RpcResult<BannerMediaView>>;
  removeAdminBannerMedia(request: BannerMediaRemoveRequest): Promise<RpcResult<BannerMediaView>>;
  getAdminBannerMediaContent(
    request: BannerMediaRequest & { mediaId: string },
  ): Promise<RpcResult<BannerMediaContent>>;
  getPublishedBannerMedia(
    request: PublishedBannerMediaRequest,
  ): Promise<RpcResult<BannerMediaContent>>;
  listPublishedBanners(request: {
    requestId: string;
  }): Promise<RpcResult<{ items: PublishedBanner[] }>>;
};
