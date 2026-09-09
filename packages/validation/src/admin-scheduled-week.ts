import { z } from "zod";
const identifierSchema = z.string().trim().min(1).max(200);
const integer = z.number().int().safe().nonnegative();
export const scheduledWeekQuerySchema = z.object({
  locationId: identifierSchema,
  cycleId: identifierSchema.optional(),
  cycleCursor: identifierSchema.optional(),
  section: z.enum(["DEMAND", "ORDERS", "OFFERS"]).default("DEMAND"),
  cursor: identifierSchema.optional(),
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
      procurementAt: integer.nullable(),
      preparationAt: integer.nullable(),
      pickupAt: integer.nullable(),
      windows: z.array(z.object({ name: z.string(), startsAt: integer, endsAt: integer })),
    })
    .nullable(),
  page: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("DEMAND"),
      nextCursor: identifierSchema.nullable(),
      items: z.array(
        z.object({
          skuId: identifierSchema,
          inventoryPoolId: identifierSchema,
          productName: z.string(),
          variantName: z.string(),
          quantitySellable: integer,
          quantityBase: integer,
          baseUnit: z.string(),
          shippingGrams: integer,
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
      nextCursor: identifierSchema.nullable(),
      items: z.array(
        z.object({
          orderId: identifierSchema,
          status: z.string(),
          preparationStatus: z.string().nullable(),
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
