import { appErrorCodes } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";

export function refundAmountMinor(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

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
