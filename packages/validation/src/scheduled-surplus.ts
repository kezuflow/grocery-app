import { z } from "zod";
const id = z.string().trim().min(1).max(200);
const quantity = z.number().int().safe().nonnegative();
export const releaseScheduledSurplusBodySchema = z
  .object({
    cycleId: id,
    locationId: id,
    inventoryPoolId: id,
    quantityBase: quantity.positive(),
    expectedVersion: quantity.positive(),
    inspected: z.literal(true),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const scheduledSurplusViewSchema = z.object({
  cycleId: id,
  cycleName: z.string(),
  locationId: id,
  inventoryPoolId: id,
  productName: z.string(),
  unit: z.string(),
  availableBase: quantity,
  releasedBase: quantity,
  version: quantity.positive(),
  blockedReason: z.string().nullable(),
});
export const scheduledSurplusReleaseViewSchema = z.object({
  movementId: id,
  quantityBase: quantity.positive(),
  version: quantity.positive(),
});
