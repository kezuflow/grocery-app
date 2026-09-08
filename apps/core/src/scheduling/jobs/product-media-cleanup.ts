import type { ScheduledJob } from "../types";
import { cleanProductMedia } from "../../admin/application/product-media-recovery";

export const productMediaCleanupJob: ScheduledJob = {
  name: "catalog.product-media-cleanup",
  async run({ database, productMedia, now }) {
    if (!productMedia) return { status: "SKIPPED", errorCode: "MEDIA_STORAGE_UNAVAILABLE" };
    return { status: "SUCCEEDED", affected: await cleanProductMedia(database, productMedia, now) };
  },
};
