import { z } from "zod";
const id = z.string().trim().min(1).max(200);
const quantity = z.number().int().safe().nonnegative();
export const scheduledCountedReceiptBodySchema = z
  .object({
    locationId: id,
    cycleId: id,
    productId: id,
    receivedWeightGrams: quantity,
    receiptKind: z.enum(["DELIVERY", "REPLACEMENT"]),
    reason: z.string().trim().min(1).max(500),
    lines: z
      .array(
        z
          .object({
            receivingSessionId: id,
            expectedVersion: quantity.positive(),
            acceptedBase: quantity,
            rejectedBase: quantity,
            shortageBase: quantity,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const scheduledCountedReceiptViewSchema = z.object({
  cycleName: z.string(),
  receiptId: id,
  cycleId: id,
  productId: id,
  productName: z.string(),
  receivedWeightGrams: quantity,
  receiptKind: z.enum(["DELIVERY", "REPLACEMENT"]),
  receivedAt: z.number().int().safe(),
  lines: z.array(
    z.object({
      receivingSessionId: id,
      skuId: id,
      variantName: z.string(),
      acceptedBase: quantity,
      rejectedBase: quantity,
      shortageBase: quantity,
    }),
  ),
});
