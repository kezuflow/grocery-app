import { cleanBannerMedia } from "../../admin/application/banner-media-storage";
import { cleanPromotionMedia } from "../../admin/application/promotion-media-storage";
import type { ScheduledJob } from "../types";
import { cleanProductMedia } from "../../admin/application/product-media-recovery";

export const productMediaCleanupJob: ScheduledJob = {
  name: "catalog.product-media-cleanup",
  async run({ database, productMedia, now }) {
    if (!productMedia) return { status: "SKIPPED", errorCode: "MEDIA_STORAGE_UNAVAILABLE" };
    const products = await cleanProductMedia(database, productMedia, now);
    const banners = await cleanBannerMedia(database, productMedia, now);
    const campaigns = await cleanPromotionMedia(database, productMedia, now);
    return { status: "SUCCEEDED", affected: products + campaigns + banners };
  },
};
