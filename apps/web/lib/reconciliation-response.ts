import { reconciliationCaseCategories } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
export const reconciliationCaseSchema = z.object({
  providerEventRecovery: z
    .object({
      canRetry: z.boolean(),
      attempts: z.number().int().safe().nonnegative(),
      state: z.string(),
      unavailableReason: z.string().nullable(),
    })
    .optional(),
  paymentReactionRecovery: z
    .object({
      canRetry: z.boolean(),
      attempts: z.number().int().safe().nonnegative(),
      state: z.string(),
      paymentVersion: z.number().int().safe().positive(),
      unavailableReason: z.string().nullable(),
    })
    .optional(),
  caseId: z.string(),
  paymentIntentId: z.string().nullable(),
  category: z.enum(reconciliationCaseCategories),
  status: z.enum(["OPEN", "RESOLVED"]),
  version: z.number().int().safe().positive(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolutionUnavailableReason: z.string().nullable(),
});
const failure = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});
export const reconciliationPageResponse = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      items: z.array(reconciliationCaseSchema),
      nextCursor: z.string().nullable(),
    }),
  }),
  failure,
]);
export const reconciliationResolutionResponse = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: reconciliationCaseSchema.extend({
      status: z.literal("RESOLVED"),
      resolvedAt: z.string().datetime(),
    }),
  }),
  failure,
]);
