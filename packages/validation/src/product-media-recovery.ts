import { z } from "zod";
export const productMediaRecoveryResultSchema = z.object({
  itemId: z.string().min(1),
  kind: z.enum(["UPLOAD", "CLEANUP"]),
  status: z.enum([
    "PENDING",
    "UNKNOWN",
    "STORED",
    "ABANDONED",
    "PROCESSING",
    "SUCCEEDED",
    "FAILED",
  ]),
  version: z.number().int().safe().positive(),
});
export const productMediaRecoveryActionSchema = z.enum([
  "OBSERVE_UPLOAD",
  "DISCARD_UPLOAD",
  "RETRY_CLEANUP",
]);
export const productMediaRecoveryViewSchema = z.object({
  productId: z.string().min(1),
  nextCursor: z.string().nullable(),
  items: z.array(
    productMediaRecoveryResultSchema.extend({
      label: z.string(),
      createdAt: z.number().int().safe().nonnegative(),
      updatedAt: z.number().int().safe().nonnegative(),
      attempts: z.number().int().safe().nonnegative(),
      availableAt: z.number().int().safe().nullable(),
      errorCode: z.string().nullable(),
      allowedActions: z.array(productMediaRecoveryActionSchema),
    }),
  ),
});
