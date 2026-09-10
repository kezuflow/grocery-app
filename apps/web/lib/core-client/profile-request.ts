import { z } from "@freshmarkets/validation";

export const customerProfileRequestSchema = z
  .object({
    accountPhone: z.string().trim().max(40).nullable().optional(),
    preferredLanguage: z.string().trim().min(1).max(80).nullable(),
    promotionalEmails: z.boolean(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
