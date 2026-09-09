import { z } from "zod";
import { adminProductMediaViewSchema } from "./admin-catalog-media";
import { adminCategoryDetailSchema } from "./admin-categories";
const id = z.string().trim().min(1).max(200);
export const adminProductCustomerDetailSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(1000),
  sortOrder: z.number().int().safe().min(0).max(10000),
});
const details = z
  .array(adminProductCustomerDetailSchema)
  .max(20)
  .refine(
    (items) => new Set(items.map((item) => item.label.toLowerCase())).size === items.length,
    "Detail labels must be unique",
  )
  .transform((items) =>
    [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
  );
export const adminProductCreateBodySchema = z.object({
  categoryId: id,
  name: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .transform((value) => value || null),
  customerDetails: details,
  inventoryBaseUnitId: id,
  stockTracking: z.enum(["SHARED", "COUNTED_SIZES"]).default("SHARED"),
});
export const adminProductUpdateBodySchema = adminProductCreateBodySchema
  .omit({ inventoryBaseUnitId: true, stockTracking: true })
  .extend({ expectedVersion: z.number().int().safe().positive() });
export const adminProductStatusBodySchema = z.object({
  status: z.enum(["active", "inactive"]),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().safe().positive(),
});
export const adminProductSummarySchema = z.object({
  productId: id,
  slug: z.string(),
  name: z.string(),
  categoryCode: z.string(),
  status: z.enum(["active", "inactive"]),
  skuCount: z.number().int().safe().nonnegative(),
  version: z.number().int().safe().positive(),
});
const integer = z.number().int().safe();
const status = z.enum(["active", "inactive"]);
const baseCode = z.enum(["GRAM", "PIECE", "MILLILITER"]);
export const adminUnitCreateBodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  displayName: z.string().trim().min(1).max(60),
  dimension: z.enum(["MASS", "COUNT", "VOLUME"]),
  canonicalBaseCode: baseCode,
  conversionNumerator: integer.positive(),
  conversionDenominator: integer.positive(),
});
export const adminSkuCreateBodySchema = z.object({
  productId: id,
  code: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  sellableUnitId: id,
  sellQuantity: integer.positive(),
  consumptionBaseQuantity: integer.positive(),
  estimatedShippingWeightGrams: integer.positive().optional(),
  merchandisingLabel: z.string().trim().max(60).nullable().optional(),
  sortOrder: integer.min(0).max(10000).optional(),
});
export const adminSkuUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  merchandisingLabel: z.string().trim().max(60).nullable().optional(),
  status: status.optional(),
  sortOrder: integer.min(0).max(10000).optional(),
  estimatedShippingWeightGrams: integer.positive().optional(),
  expectedVersion: integer.positive(),
});
export const adminSkuAvailabilityBodySchema = z.object({
  locationId: id,
  availabilityStatus: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  expectedVersion: integer.nonnegative(),
});
export const adminSkuPriceBodySchema = z.object({
  marketId: id,
  locationId: id,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  amountMinor: integer.positive(),
  validFrom: integer.positive(),
  expectedVersion: integer.nonnegative(),
});
export const adminUnitSummarySchema = z.object({
  unitId: id,
  code: z.string(),
  displayName: z.string(),
  dimension: z.enum(["MASS", "COUNT", "VOLUME"]),
  canonicalBaseCode: baseCode,
  conversionNumerator: integer.positive(),
  conversionDenominator: integer.positive(),
  status,
  version: integer.positive(),
});
export const adminCatalogSkuSummarySchema = z.object({
  stockPoolId: id.nullable().optional(),
  availableBase: z.number().int().safe().nonnegative().nullable().optional(),
  skuId: id,
  code: z.string(),
  name: z.string(),
  merchandisingLabel: z.string().nullable(),
  unitSymbol: z.string(),
  sellQuantity: integer.positive(),
  consumptionBaseQuantity: integer.positive(),
  estimatedShippingWeightGrams: integer.positive().nullable(),
  status,
  sortOrder: integer.nonnegative(),
  version: integer.positive(),
  priceMinor: integer.nullable(),
  currency: z.string().nullable(),
  priceVersion: integer.nullable(),
  availability: z.enum(["AVAILABLE", "UNAVAILABLE"]).nullable(),
  availabilityVersion: integer.nullable(),
});
export const adminProductDetailSchema = adminProductSummarySchema.omit({ skuCount: true }).extend({
  categoryId: id,
  categoryName: z.string(),
  description: z.string().nullable(),
  customerDetails: z.array(adminProductCustomerDetailSchema.extend({ detailId: id })),
  media: z.array(adminProductMediaViewSchema),
  inventoryPool: z.object({
    stockTracking: z.enum(["SHARED", "COUNTED_SIZES"]).optional(),
    inventoryPoolId: id,
    baseUnitId: id,
    baseUnitCode: baseCode,
    baseUnitSymbol: z.string(),
    position: z
      .object({
        locationId: id,
        onHandBase: integer,
        reservedBase: integer,
        availableBase: integer,
        version: integer,
      })
      .nullable(),
  }),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("GLOBAL") }),
    z.object({
      kind: z.literal("LOCATION"),
      marketId: id,
      marketName: z.string(),
      locationId: id,
      locationName: z.string(),
      currency: z.string(),
    }),
  ]),
  allowedActions: z.array(z.enum(["UPDATE", "SET_STATUS"])),
  recentAudit: adminCategoryDetailSchema.shape.recentAudit,
  skus: z.array(adminCatalogSkuSummarySchema),
});
