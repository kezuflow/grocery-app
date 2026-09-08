import { z } from "zod";
export const locationFulfillmentSettingsSchema = z.object({
  dispatchReady: z.boolean(),
  instantPromiseMinutes: z.number().int().safe().positive().nullable(),
});
export const adminLocationFulfillmentViewSchema = locationFulfillmentSettingsSchema.extend({
  locationId: z.string(),
  locationName: z.string(),
  version: z.number().int().safe().positive(),
  blockers: z.array(z.string()),
  canManage: z.boolean(),
});
