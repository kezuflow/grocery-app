import { z } from "zod";
const identifierSchema = z.string().trim().min(1).max(200);
const integer = z.number().int().safe().nonnegative();
const cursorSchema = z.string().trim().min(1).max(4096);
export const scheduledPurchaseQuantitySchema = z.object({
  sizeLabel: z.string().nullable(),
  unit: z.enum(["GRAM", "MILLILITER", "PIECE"]),
  quantity: integer,
});
export const supplierPurchaseListQuerySchema = z.object({
  cycleId: identifierSchema,
  locationId: identifierSchema.optional(),
});
export const supplierPurchaseListSchema = z.object({
  cycleName: z.string(),
  scopeName: z.string(),
  generatedAt: integer,
  items: z.array(scheduledPurchaseQuantitySchema.extend({ productName: z.string() })),
});
const sellingOptionSummarySchema = z.object({
  purchaseQuantity: scheduledPurchaseQuantitySchema.optional(),
  skuId: identifierSchema,
  inventoryPoolId: identifierSchema,
  productName: z.string(),
  variantName: z.string(),
  unitName: z.string(),
  baseUnit: z.enum(["GRAM", "MILLILITER", "PIECE"]),
  paidOrderCount: integer,
  soldUnitCount: integer,
  totalQuantityBase: integer,
  destinationCount: integer,
  destinations: z.array(
    z.object({
      purchaseQuantity: scheduledPurchaseQuantitySchema.optional(),
      locationId: identifierSchema,
      locationName: z.string(),
      soldUnitCount: integer,
      totalQuantityBase: integer,
    }),
  ),
});
export const scheduledWeekQuerySchema = z.object({
  locationId: identifierSchema.optional(),
  cycleId: identifierSchema.optional(),
  cycleCursor: identifierSchema.optional(),
  requirementId: identifierSchema.optional(),
  section: z.enum(["ORDER_SUMMARY", "DEMAND", "ORDERS", "OFFERS"]).default("DEMAND"),
  cursor: cursorSchema.optional(),
});
export const scheduledWeekViewSchema = z.object({
  cycles: z.array(z.object({ cycleId: identifierSchema, name: z.string(), status: z.string() })),
  nextCycleCursor: identifierSchema.nullable(),
  week: z
    .object({
      cycleId: identifierSchema,
      name: z.string(),
      status: z.string(),
      timezone: z.string(),
      orderOpensAt: integer,
      cutoffAt: integer,
      purchaseBlockedReason: z.string().nullable(),
      settlementEndsAt: integer.nullable(),
      completion: z
        .object({
          cycleId: identifierSchema,
          locationId: identifierSchema,
          version: integer.positive(),
          paidOrderCount: integer.positive(),
          purchaseCompletedAt: integer,
        })
        .nullable(),
      canCompletePurchase: z.boolean(),
      procurementAt: integer.nullable(),
      preparationAt: integer.nullable(),
      pickupAt: integer.nullable(),
      windows: z.array(z.object({ name: z.string(), startsAt: integer, endsAt: integer })),
    })
    .nullable(),
  page: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ORDER_SUMMARY"),
      nextCursor: cursorSchema.nullable(),
      totals: z.object({
        paidOrderCount: integer,
        productCount: integer,
        sellingOptionCount: integer,
        destinationCount: integer,
      }),
      items: z.array(
        z.object({
          productId: identifierSchema,
          productName: z.string(),
          paidOrderCount: integer,
          destinationCount: integer,
          purchaseQuantities: z.array(scheduledPurchaseQuantitySchema).optional(),
          quantities: z
            .array(
              z.object({
                inventoryPoolId: identifierSchema,
                baseUnit: z.enum(["GRAM", "MILLILITER", "PIECE"]),
                totalQuantityBase: integer,
                sellingOptionNames: z.array(z.string()),
              }),
            )
            .min(1),
          sellingOptions: z.array(sellingOptionSummarySchema).min(1),
        }),
      ),
    }),
    z.object({
      kind: z.literal("DEMAND"),
      nextCursor: cursorSchema.nullable(),
      items: z.array(
        z.object({
          locationId: identifierSchema,
          locationName: z.string(),
          totalQuantityBase: integer,
          totalQuantitySellable: integer,
          skuId: identifierSchema,
          inventoryPoolId: identifierSchema,
          productName: z.string(),
          variantName: z.string(),
          quantitySellable: integer,
          quantityBase: integer,
          baseUnit: z.string(),
          shippingGrams: integer.nullable(),
          requirementId: identifierSchema.nullable(),
          requirementVersion: integer,
          status: z.string(),
          acceptedBase: integer,
          rejectedBase: integer,
          shortageBase: integer,
          replacementBase: integer,
          receivingStatus: z.string().nullable(),
          canConfirmPurchase: z.boolean(),
        }),
      ),
    }),
    z.object({
      kind: z.literal("ORDERS"),
      denied: z.boolean(),
      requirement: z
        .object({
          id: identifierSchema,
          productName: z.string(),
          variantName: z.string(),
          baseUnit: z.string(),
        })
        .nullable(),
      nextCursor: identifierSchema.nullable(),
      items: z.array(
        z.object({
          orderId: identifierSchema,
          status: z.string(),
          preparationStatus: z.string().nullable(),
          openQuantityBase: integer.nullable(),
          cancellationStatus: z.string().nullable(),
        }),
      ),
    }),
    z.object({
      kind: z.literal("OFFERS"),
      nextCursor: identifierSchema.nullable(),
      items: z.array(
        z.object({
          skuId: identifierSchema,
          productName: z.string(),
          variantName: z.string(),
          priceMinor: integer.nullable(),
          currency: z.string().nullable(),
        }),
      ),
    }),
  ]),
});

export const scheduledWeekCompletionBodySchema = z
  .object({
    cycleId: identifierSchema,
    locationId: identifierSchema,
    expectedVersion: integer,
  })
  .strict();

export const confirmProcurementPurchaseBodySchema = z
  .object({
    locationId: identifierSchema,
    cycleId: identifierSchema,
    inventoryPoolId: identifierSchema,
    skuId: identifierSchema,
    expectedVersion: integer,
    expectedQuantityBase: integer.positive(),
    expectedQuantitySellable: integer.positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
