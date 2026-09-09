import { z } from "zod";
export const promotionCodeMaxLength = 80;

const manageableBenefitTypes = [
  "ORDER_FIXED_DISCOUNT",
  "ORDER_PERCENT_DISCOUNT",
  "DELIVERY_FEE_WAIVER",
  "DELIVERY_PERCENT_DISCOUNT",
  "DELIVERY_FIXED_DISCOUNT",
] as const;
const promotionStatuses = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;
const integer = z.number().int().safe();
const id = z.string().min(1).max(200);
export const adminPromotionProductTargetInputSchema = z.object({
  skuId: id,
  locationId: id,
  quantityLimit: integer.positive().nullable(),
});
export const adminPromotionProductTargetSchema = adminPromotionProductTargetInputSchema.extend({
  remainingQuantity: integer.nonnegative().nullable(),
  productName: z.string().optional(),
  skuName: z.string().optional(),
  locationName: z.string().optional(),
});
const editable = {
  productTargets: z.array(adminPromotionProductTargetInputSchema).max(100).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  discountMinor: integer.positive().optional(),
  percent: integer.min(1).max(100).optional(),
  maximumDiscountMinor: integer.positive().nullable().optional(),
  globalUsageLimit: integer.positive().nullable().optional(),
  perCustomerUsageLimit: integer.positive().nullable().optional(),
  automatic: z.boolean().optional(),
  minimumMinor: integer.nonnegative(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
};
export const adminPromotionCreateBodySchema = z.object({
  ...editable,
  code: z
    .string()
    .trim()
    .max(promotionCodeMaxLength)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  benefitType: z.enum(manageableBenefitTypes),
  globalUsageLimit: integer.positive().nullable().optional(),
  perCustomerUsageLimit: integer.positive().nullable().optional(),
  automatic: z.boolean().optional(),
  priority: integer.min(0).max(10000).optional(),
});
export const adminPromotionUpdateBodySchema = z.object({
  ...editable,
  expectedVersion: integer.positive(),
});
export const adminPromotionStatusBodySchema = z.object({
  action: z.enum(["ACTIVATE", "DEACTIVATE", "ARCHIVE"]),
  reason: z.string().trim().min(1).max(1000),
  expectedVersion: integer.positive(),
});
export const adminPromotionGrantBodySchema = z.object({
  customerId: id,
  maxRedemptions: integer.positive(),
});
export const adminPromotionSummarySchema = z.object({
  productTargets: z.array(adminPromotionProductTargetSchema).optional(),
  promotionId: id,
  code: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(promotionStatuses),
  benefitType: z.enum(manageableBenefitTypes),
  discountMinor: integer.nullable(),
  percent: integer.nullable(),
  maximumDiscountMinor: integer.nullable().optional(),
  minimumMinor: integer,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  globalUsageLimit: integer.nullable(),
  perCustomerUsageLimit: integer.nullable(),
  automatic: z.boolean(),
  priority: integer,
  version: integer.positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const adminPromotionGrantViewSchema = z.object({
  grantId: id,
  promotionId: id,
  customerId: id,
  benefitType: z.enum(manageableBenefitTypes),
  maxRedemptions: integer.positive(),
  status: z.string(),
  createdAt: z.iso.datetime(),
});
export const adminPromotionPageSchema = z.object({
  items: z.array(adminPromotionSummarySchema),
  nextCursor: z.string().nullable(),
});

export const adminPromotionPreviewBodySchema = z.object({
  subtotalMinor: integer.nonnegative(),
  deliverySubtotalMinor: integer.nonnegative().optional(),
  customerId: id.optional(),
});

export const adminPromotionPreviewViewSchema = z.object({
  eligibilityChecked: z.boolean(),
  eligible: z.boolean(),
  discountMinor: integer.nonnegative().nullable(),
  reasonCode: z
    .enum([
      "PROMOTION_INACTIVE",
      "PROMOTION_NOT_STARTED",
      "PROMOTION_EXPIRED",
      "MINIMUM_ORDER_NOT_MET",
      "CUSTOMER_INELIGIBLE",
      "CUSTOMER_UNAVAILABLE",
    ])
    .nullable(),
});

export const promotionRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FIRST_ORDER"), parameters: z.object({}).strict() }).strict(),
  z.object({ type: z.literal("NEW_CUSTOMER"), parameters: z.object({}).strict() }).strict(),
  z
    .object({
      type: z.literal("MINIMUM_SUBTOTAL"),
      parameters: z.object({ minimumMinor: integer.nonnegative() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("CUSTOMER_SEGMENT"),
      parameters: z.object({ segmentId: id }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SPECIFIC_CUSTOMERS"),
      parameters: z
        .object({
          customerIds: z
            .array(id)
            .min(1)
            .max(20)
            .refine((ids) => new Set(ids).size === ids.length),
        })
        .strict(),
    })
    .strict(),
]);
export const adminPromotionAudienceBodySchema = z.object({
  rules: z.array(promotionRuleSchema).max(10),
  expectedVersion: integer.positive(),
});
export const adminPromotionAudienceSchema = z.object({
  promotionId: id,
  version: integer.positive(),
  rules: z.array(promotionRuleSchema),
});
export const adminPromotionAudienceViewSchema = adminPromotionAudienceSchema.extend({
  unsupportedRuleCount: integer.nonnegative(),
  segments: z.array(z.object({ segmentId: id, name: z.string() })),
  moreSegments: z.boolean(),
  customers: z.array(z.object({ customerId: id, label: z.string() })),
});
