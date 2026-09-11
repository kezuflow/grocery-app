import { z } from "zod";
const id = z.string().min(1).max(200);
const version = z.number().int().safe().positive();
export const bannerMediaMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const bannerMediaViewSchema = z.object({
  bannerId: id,
  mediaId: id,
  version,
  altText: z.string().trim().min(1).max(300),
  mimeType: bannerMediaMimeSchema,
  status: z.enum(["active", "inactive"]),
});
export const bannerMediaUploadBodySchema = z.object({
  altText: z.string().trim().min(1).max(300),
  expectedMedia: z.object({ mediaId: id, version }).nullable(),
});
export const bannerMediaUpdateBodySchema = z.object({
  mediaId: id,
  expectedVersion: version,
  altText: z.string().trim().min(1).max(300),
});
export const bannerMediaRemoveBodySchema = bannerMediaUpdateBodySchema.omit({
  altText: true,
});
