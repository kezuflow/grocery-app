import { appErrorCodes } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";

export const refundResponse = z.union([
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
  }),
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: z.object({
      refundId: z.string(),
      paymentIntentId: z.string(),
      amountMinor: z.number().int().safe().positive(),
      currency: z.string(),
      status: z.literal("REQUESTED"),
      reason: z.string(),
      createdAt: z.string(),
    }),
  }),
]);
