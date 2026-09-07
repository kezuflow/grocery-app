import { z } from "zod";

export const locationCapabilitySchema = z.enum([
  "RECEIVING",
  "INVENTORY",
  "PROCUREMENT",
  "PICKING",
  "PACKING",
  "DISPATCH",
]);
export const locationPurposeSchema = z.enum(["CUSTOMER_FULFILLMENT", "CENTRAL_WAREHOUSE"]);
const optionalText = z.string().trim().min(1).max(200).nullable();
export const locationAddressSchema = z.object({
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: optionalText,
  barangay: optionalText,
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20).nullable(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
});
export const adminLocationDetailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: locationAddressSchema,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  capabilities: z
    .array(locationCapabilitySchema)
    .max(6)
    .refine((values) => new Set(values).size === values.length, "Capabilities must be unique"),
});
export const adminLocationViewSchema = adminLocationDetailsSchema.extend({
  address: locationAddressSchema.nullable(),
  locationId: z.string(),
  marketId: z.string(),
  marketName: z.string(),
  currency: z.string(),
  timezone: z.string(),
  code: z.string(),
  purpose: locationPurposeSchema,
  status: z.enum(["active", "inactive"]),
  version: z.number().int().positive(),
});
export const adminLocationsViewSchema = z.object({
  items: z.array(adminLocationViewSchema),
  nextCursor: z.string().nullable(),
  canManage: z.boolean(),
  markets: z.array(
    z.object({
      marketId: z.string(),
      name: z.string(),
      currency: z.string(),
      timezone: z.string(),
    }),
  ),
});
