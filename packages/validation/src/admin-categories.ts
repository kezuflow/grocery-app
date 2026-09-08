import { z } from "zod";
const identifier = z.string().trim().min(1).max(200);
const name = z.string().trim().min(1).max(120);
const slug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const iconAssetKey = z
  .string()
  .trim()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/)
  .nullable();
const sortOrder = z.number().int().safe().min(0).max(10000);
const version = z.number().int().safe().positive();
export const adminCategoryCreateBodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  name,
  slug,
  sortOrder: sortOrder.default(0),
  parentCategoryId: identifier.nullable().default(null),
  iconAssetKey: iconAssetKey.default(null),
});
export const adminCategoryUpdateBodySchema = z.object({
  name,
  slug,
  sortOrder,
  parentCategoryId: identifier.nullable(),
  iconAssetKey,
  expectedVersion: version,
});
export const adminCategoryStatusBodySchema = z.object({
  status: z.enum(["active", "inactive"]),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: version,
});
export const adminCategorySummarySchema = z.object({
  categoryId: identifier,
  code: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["active", "inactive"]),
  sortOrder: z.number().int().safe().nonnegative(),
  parentCategoryId: identifier.nullable(),
  parentName: z.string().nullable(),
  iconAssetKey: z.string().nullable(),
  productCount: z.number().int().safe().nonnegative(),
  version,
});
export const adminCategoryPageSchema = z.object({
  items: z.array(adminCategorySummarySchema),
  nextCursor: z.string().nullable(),
});
export const adminCategoryDetailSchema = adminCategorySummarySchema
  .omit({
    parentCategoryId: true,
    parentName: true,
    productCount: true,
  })
  .extend({
    parent: adminCategorySummarySchema
      .pick({ categoryId: true, code: true, name: true })
      .nullable(),
    children: z.array(adminCategorySummarySchema),
    products: z.array(
      z.object({
        productId: identifier,
        slug: z.string(),
        name: z.string(),
        status: z.enum(["active", "inactive"]),
        skuCount: z.number().int().safe().nonnegative(),
        version,
      }),
    ),
    allowedActions: z.array(z.enum(["UPDATE", "SET_STATUS"])),
    recentAudit: z.array(
      z.object({
        auditEventId: identifier,
        occurredAt: z.string(),
        actorId: z.string().nullable(),
        action: z.string(),
        resourceType: z.string(),
        resourceId: z.string(),
        marketId: z.string().nullable(),
        locationId: z.string().nullable(),
        reason: z.string().nullable(),
        correlationId: z.string().nullable(),
      }),
    ),
  });
