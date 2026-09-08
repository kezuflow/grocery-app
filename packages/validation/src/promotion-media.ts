import { z } from "zod";
const id = z.string().min(1).max(200);
const version = z.number().int().safe().positive();
export const promotionMediaMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const promotionMediaViewSchema = z.object({
  promotionId: id,
  mediaId: id,
  version,
  altText: z.string().trim().min(1).max(300),
  mimeType: promotionMediaMimeSchema,
  status: z.enum(["active", "inactive"]),
});
export const promotionMediaUploadBodySchema = z.object({
  altText: z.string().trim().min(1).max(300),
  expectedMedia: z.object({ mediaId: id, version }).nullable(),
});
export const promotionMediaUpdateBodySchema = z.object({
  mediaId: id,
  expectedVersion: version,
  altText: z.string().trim().min(1).max(300),
});
export const promotionMediaRemoveBodySchema = promotionMediaUpdateBodySchema.omit({
  altText: true,
});
