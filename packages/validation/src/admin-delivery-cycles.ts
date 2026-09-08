import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const instant = z.iso.datetime({ offset: true });
const window = z.object({
  name: z.string().trim().min(1).max(120),
  startsAt: instant,
  endsAt: instant,
});
export const deliveryCycleDraftSchema = z
  .object({
    cycleId: id.optional(),
    marketId: id,
    name: z.string().trim().min(1).max(120),
    orderOpensAt: instant,
    cutoffAt: instant,
    procurementAt: instant,
    preparationAt: instant,
    pickupAt: instant,
    windows: z.array(window).min(1).max(30),
    participation: z
      .array(z.object({ zoneId: id, locationId: id }))
      .min(1)
      .max(100),
    expectedVersion: z.number().int().safe().nonnegative(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const adminDeliveryCycleViewSchema = z.object({
  cycleId: id,
  marketId: id,
  marketName: z.string(),
  name: z.string(),
  status: z.enum([
    "DRAFT",
    "SCHEDULED",
    "OPEN",
    "CUTOFF_REACHED",
    "PROCUREMENT",
    "RECEIVING",
    "PACKING",
    "DISPATCHING",
    "DELIVERING",
    "CLOSED",
    "CANCELED",
  ]),
  version: z.number().int().safe().positive(),
  cancellationUnavailableReason: z.string().nullable(),
  timezone: z.string(),
  orderOpensAt: instant,
  cutoffAt: instant,
  procurementAt: instant.nullable(),
  preparationAt: instant.nullable(),
  pickupAt: instant.nullable(),
  windows: z.array(window.extend({ windowId: id })),
  participation: z.array(
    z.object({ zoneId: id, zoneName: z.string(), locationId: id, locationName: z.string() }),
  ),
});
export const adminDeliveryCyclePageSchema = z.object({
  items: z.array(adminDeliveryCycleViewSchema),
  markets: z.array(z.object({ marketId: id, name: z.string(), timezone: z.string() })),
  nextCursor: z.string().nullable(),
  canManage: z.boolean(),
});
export const adminCycleDestinationsSchema = z.object({
  items: z.array(
    z.object({ zoneId: id, zoneName: z.string(), locationId: id, locationName: z.string() }),
  ),
  nextCursor: z.string().nullable(),
});
