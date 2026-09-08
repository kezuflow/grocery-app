import { z } from "zod";

export const locationDeliveryProfileViewSchema = z.object({
  locationId: z.string().min(1),
  locationName: z.string(),
  coordinate: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }),
  profile: z
    .object({
      senderName: z.string().min(1),
      phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
      email: z.string().nullable(),
      formattedAddress: z.string().min(1),
      addressLine1: z.string().min(1),
      addressLine2: z.string().nullable(),
      barangay: z.string().nullable(),
      city: z.string().min(1),
      region: z.string().nullable(),
      postalCode: z.string().nullable(),
      countryCode: z.string().length(2),
      pickupInstructions: z.string().nullable(),
      version: z.number().int().safe().positive(),
    })
    .nullable(),
});
