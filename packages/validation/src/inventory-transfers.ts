import { z } from "zod";
const identifierSchema = z.string().trim().min(1).max(200);
const idempotencyKeySchema = identifierSchema;

const quantity = z.number().int().safe().nonnegative();
const positive = quantity.positive();
export const inventoryTransferStatusSchema = z.enum([
  "DRAFT",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
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
      .array(z.object({ lineId: identifierSchema, acceptedBase: positive }).strict())
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
  reason: z.string(),
  allowedActions: z.array(z.enum(["DISPATCH", "RECEIVE", "CANCEL"])),
  lines: z.array(
    z.object({
      lineId: identifierSchema,
      inventoryPoolId: identifierSchema,
      productName: z.string(),
      baseUnit: z.enum(["GRAM", "PIECE"]),
      quantityBase: positive,
      acceptedBase: quantity,
      outstandingBase: quantity,
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
