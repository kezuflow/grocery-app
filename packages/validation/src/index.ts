import { z } from "zod";

export { z } from "zod";

export const identifierSchema = z.string().trim().min(1).max(200);
export const idempotencyKeySchema = z.string().trim().min(1).max(200);
export const positiveIntegerSchema = z.number().int().safe().positive();
export const nonZeroIntegerSchema = z
  .number()
  .int()
  .safe()
  .refine((value) => value !== 0);
export const coordinateSchema = z.number().finite();
export const reasonSchema = z.string().trim().min(1).max(1000);
// Concurrent lifecycle mutation requires an explicit optimistic version.
export const expectedVersionSchema = z.number().int().safe().nonnegative();

export const requestMetaSchema = z.object({
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
});

export const authenticatedRequestSchema = requestMetaSchema.extend({
  headers: z.record(z.string(), z.string()),
});

export type RequestMetaInput = z.infer<typeof requestMetaSchema>;
