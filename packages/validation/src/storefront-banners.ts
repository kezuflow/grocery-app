import { z } from "zod";
// Reject control characters and backslashes before a browser interprets the destination.
const href = z
  .string()
  .trim()
  .max(1000)
  .refine(
    // eslint-disable-next-line no-control-regex
    (value) => /^\/(?!\/)/.test(value) && !/[\\\s\u0000-\u001f]/.test(value),
    "Use a storefront path starting with /",
  )
  .nullable();
export const storefrontBannerSchema = z.object({
  bannerId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(150),
  href,
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
  priority: z.number().int().min(-10000).max(10000),
  startsAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  endsAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  image: z.object({ src: z.string(), alt: z.string() }).nullable().optional(),
  version: z.number().int().positive(),
});
export const saveStorefrontBannerBodySchema = storefrontBannerSchema
  .omit({ version: true, image: true })
  .extend({ expectedVersion: z.number().int().nonnegative() })
  .refine(
    (value) => value.endsAt === null || value.endsAt > value.startsAt,
    "End must be after start",
  );
export const storefrontBannerListSchema = z.object({ items: z.array(storefrontBannerSchema) });
