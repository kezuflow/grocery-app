import { z } from "zod";
export const adminProductMediaViewSchema = z.object({
  mediaId: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  altText: z.string().trim().min(1).max(300),
  isPrimary: z.boolean(),
  sortOrder: z.number().int().safe().min(0).max(10000),
  status: z.enum(["active", "inactive"]),
  version: z.number().int().safe().positive(),
});
