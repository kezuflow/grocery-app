import { z } from "zod";

export const requestMetaSchema = z.object({
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
});

export type RequestMetaInput = z.infer<typeof requestMetaSchema>;
