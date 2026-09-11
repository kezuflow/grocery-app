import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
export type StorefrontBanner = {
  bannerId: string;
  name: string;
  href: string | null;
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
  priority: number;
  startsAt: number;
  endsAt: number | null;
  version: number;
  image?: { src: string; alt: string } | null;
};
export type SaveStorefrontBannerRequest = AuthenticatedRequest & {
  idempotencyKey: string;
  bannerId: string;
  expectedVersion: number;
  name: string;
  href: string | null;
  status: StorefrontBanner["status"];
  priority: number;
  startsAt: number;
  endsAt: number | null;
};
export interface StorefrontBannerService {
  listAdminBanners(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<{ items: StorefrontBanner[] }>>;
  saveAdminBanner(request: SaveStorefrontBannerRequest): Promise<RpcResult<StorefrontBanner>>;
}
