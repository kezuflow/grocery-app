import { z } from "zod";
const identifier = z.string().trim().min(1).max(200);
const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const name = z.string().trim().min(1).max(120);
export const serviceCoordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export const serviceVerticesSchema = z.array(serviceCoordinateSchema).min(3).max(100);
export const serviceZoneDefinitionSchema = z.object({
  code,
  name,
  vertices: serviceVerticesSchema,
  locationIds: z
    .array(identifier)
    .min(1)
    .max(50)
    .refine((values) => new Set(values).size === values.length),
});
export const serviceAreaDefinitionSchema = z.object({
  marketId: identifier,
  code,
  name,
  vertices: serviceVerticesSchema,
  zones: z
    .array(serviceZoneDefinitionSchema)
    .min(1)
    .max(20)
    .refine((values) => new Set(values.map((value) => value.code)).size === values.length),
});
export const adminServiceAreaViewSchema = serviceAreaDefinitionSchema.extend({
  zones: z.array(serviceZoneDefinitionSchema.extend({ locationIds: z.array(identifier) })),
  serviceAreaId: identifier,
  version: z.number().int().positive(),
});
export const adminServiceabilityViewSchema = z.object({
  nextCursor: z.string().nullable(),
  locationsNextCursor: z.string().nullable(),
  areas: z.array(adminServiceAreaViewSchema),
  locations: z.array(
    z.object({
      locationId: identifier,
      marketId: identifier,
      name,
      unavailable: z.boolean().optional(),
    }),
  ),
  markets: z.array(z.object({ marketId: identifier, name })),
  canManage: z.boolean(),
});
export const adminServiceabilityPreviewSchema = z.object({
  serviceable: z.boolean(),
  locationId: identifier.nullable(),
  locationName: name.nullable(),
  zoneName: name.nullable(),
  reason: z.string().nullable(),
});
