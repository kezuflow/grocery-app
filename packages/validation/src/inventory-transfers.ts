import { z } from "zod";
const identifierSchema = z.string().trim().min(1).max(200);
const idempotencyKeySchema = identifierSchema;

const quantity = z.number().int().safe().nonnegative();
const positive = quantity.positive();
export const inventorySizeCountsSchema = z
  .array(
    z.object({ skuId: identifierSchema, quantity: z.number().int().safe().positive() }).strict(),
  )
  .min(1)
  .max(50)
  .refine(
    (items) => new Set(items.map((item) => item.skuId)).size === items.length,
    "Each size must appear once",
  );
export const inventoryTransferStatusSchema = z.enum([
  "DRAFT",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "RESOLVED",
  "CANCELED",
]);
export const inventoryTransferListSchema = z
  .object({
    locationId: identifierSchema.optional(),
    status: inventoryTransferStatusSchema.optional(),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const inventoryTransferOptionsSchema = z
  .object({
    sourceLocationId: identifierSchema.optional(),
    query: z.string().trim().max(100).optional(),
  })
  .strict();
export const createInventoryTransferSchema = z
  .object({
    sourceLocationId: identifierSchema,
    destinationLocationId: identifierSchema,
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: idempotencyKeySchema,
    lines: z
      .array(z.object({ inventoryPoolId: identifierSchema, quantityBase: positive }).strict())
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    (input) => input.sourceLocationId !== input.destinationLocationId,
    "Select a different destination",
  )
  .refine(
    (input) => new Set(input.lines.map((line) => line.inventoryPoolId)).size === input.lines.length,
    "Each product pool must appear once",
  );
export const inventoryTransferCommandSchema = z
  .object({
    transferId: identifierSchema,
    expectedVersion: positive,
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const receiveInventoryTransferSchema = inventoryTransferCommandSchema
  .extend({
    lines: z
      .array(
        z
          .object({
            lineId: identifierSchema,
            acceptedBase: quantity,
            sizeCounts: inventorySizeCountsSchema.optional(),
            damagedBase: quantity.optional(),
            shortageBase: quantity.optional(),
          })
          .strict()
          .refine(
            (line) =>
              line.acceptedBase > 0 ||
              line.damagedBase !== undefined ||
              line.shortageBase !== undefined,
            "Record acceptance or a checked observation",
          ),
      )
      .min(1)
      .max(50),
  })
  .refine(
    (input) => new Set(input.lines.map((line) => line.lineId)).size === input.lines.length,
    "Each transfer line must appear once",
  );
export const inventoryTransferResultSchema = z.object({
  transferId: identifierSchema,
  status: inventoryTransferStatusSchema,
  version: positive,
});
const summary = z.object({
  transferId: identifierSchema,
  sourceLocationId: identifierSchema,
  sourceLocationName: z.string(),
  destinationLocationId: identifierSchema,
  destinationLocationName: z.string(),
  status: inventoryTransferStatusSchema,
  version: positive,
  lineCount: positive,
  createdAt: quantity,
  dispatchedAt: quantity.nullable(),
});
export const inventoryTransferPageSchema = z.object({
  items: z.array(summary),
  nextCursor: z.string().nullable(),
  canCreate: z.boolean(),
});
export const inventoryTransferViewSchema = summary.extend({
  sorting: z
    .array(
      z.object({
        sortId: identifierSchema,
        lineId: identifierSchema,
        quantityGrams: positive,
        skuName: z.string(),
        quantity: positive,
      }),
    )
    .optional(),
  reason: z.string(),
  checks: z.array(
    z.object({
      checkId: identifierSchema,
      lineId: identifierSchema,
      acceptedBase: quantity,
      damagedBase: quantity,
      shortageBase: quantity,
      reason: z.string(),
      checkedAt: quantity,
    }),
  ),
  resolutions: z.array(
    z.object({
      resolutionId: identifierSchema,
      lineId: identifierSchema,
      quantityBase: positive,
      category: z.enum(["UNCLASSIFIED", "DAMAGED", "MISSING"]),
      outcome: z.enum(["LOSS", "VERIFIED_RETURN"]),
      reason: z.string(),
      resolvedAt: quantity,
    }),
  ),
  allowedActions: z.array(z.enum(["DISPATCH", "RECEIVE", "CANCEL", "RESOLVE"])),
  lines: z.array(
    z.object({
      lineId: identifierSchema,
      sizeOptions: z.array(z.object({ skuId: identifierSchema, name: z.string() })).optional(),
      inventoryPoolId: identifierSchema,
      productName: z.string(),
      baseUnit: z.enum(["GRAM", "PIECE"]),
      quantityBase: positive,
      acceptedBase: quantity,
      outstandingBase: quantity,
      damagedBase: quantity,
      shortageBase: quantity,
      lostBase: quantity,
      returnedBase: quantity,
    }),
  ),
  receipts: z.array(
    z.object({
      receiptId: identifierSchema,
      lineId: identifierSchema,
      acceptedBase: positive,
      reason: z.string(),
      receivedAt: quantity,
    }),
  ),
});
export const inventoryTransferOptionsViewSchema = z.object({
  sources: z.array(z.object({ locationId: identifierSchema, name: z.string() })),
  destinations: z.array(z.object({ locationId: identifierSchema, name: z.string() })),
  products: z.array(
    z.object({
      inventoryPoolId: identifierSchema,
      productName: z.string(),
      baseUnit: z.enum(["GRAM", "PIECE"]),
      onHandBase: quantity,
      reservedBase: quantity,
      heldBase: quantity,
      availableBase: quantity,
    }),
  ),
  moreProducts: z.boolean(),
});

export const resolveInventoryTransferSchema = inventoryTransferCommandSchema
  .extend({
    lineId: identifierSchema,
    quantityBase: positive,
    category: z.enum(["UNCLASSIFIED", "DAMAGED", "MISSING"]),
    outcome: z.enum(["LOSS", "VERIFIED_RETURN"]),
    inspectionConfirmed: z.boolean().optional(),
  })
  .refine(
    (input) => input.outcome !== "VERIFIED_RETURN" || input.inspectionConfirmed === true,
    "Confirm physical receipt and sellable inspection before crediting the warehouse",
  );
export const inventoryDistributionSchema = z
  .object({
    query: z.string().trim().max(100).optional(),
    cursor: identifierSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const inventoryDistributionPageSchema = z.object({
  items: z.array(
    z.object({
      inventoryPoolId: identifierSchema,
      productName: z.string(),
      baseUnit: z.enum(["GRAM", "PIECE"]),
      centralBase: quantity,
      localBase: quantity,
      physicalBase: quantity,
      reservedBase: quantity,
      heldBase: quantity,
      transitBase: quantity,
      damagedBase: quantity,
      shortageBase: quantity,
    }),
  ),
  nextCursor: z.string().nullable(),
});

export const sortInventoryStockSchema = z
  .object({
    locationId: identifierSchema,
    productId: identifierSchema,
    quantityGrams: z.number().int().safe().positive(),
    sizeCounts: inventorySizeCountsSchema,
    expectedVersion: z.number().int().safe().nonnegative(),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const inventorySortResultSchema = z.object({ sortId: identifierSchema });
