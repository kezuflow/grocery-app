import { z } from "zod";

export const locationOperatingScheduleSchema = z
  .object({
    weekly: z
      .array(
        z
          .object({
            dayOfWeek: z.number().int().min(1).max(7),
            opensMinute: z.number().int().min(0).max(1439),
            closesMinute: z.number().int().min(1).max(1440),
          })
          .strict(),
      )
      .max(28),
    closures: z
      .array(
        z
          .object({
            startsAt: z.iso.datetime({ offset: true }),
            endsAt: z.iso.datetime({ offset: true }),
            reason: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const adminLocationScheduleViewSchema = z.object({
  locationId: z.string(),
  locationName: z.string(),
  timezone: z.string(),
  version: z.number().int().positive(),
  schedule: locationOperatingScheduleSchema.nullable(),
  canManage: z.boolean(),
});
