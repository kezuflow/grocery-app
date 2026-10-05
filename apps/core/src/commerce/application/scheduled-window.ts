import { z } from "@freshmarkets/validation";

export const scheduledWindowSnapshotSchema = z.object({
  windowId: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().min(1),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  pickupAt: z.iso.datetime({ offset: true }),
  // Absent on retained quotes: their original cycle pickup remains accepted evidence.
  quotationTiming: z.literal("DELIVERY_START").optional(),
});
export type ScheduledWindowSnapshot = z.infer<typeof scheduledWindowSnapshotSchema>;
export async function selectScheduledWindow(
  database: D1Database,
  cycleId: string,
  windowId?: string,
  quotationTiming: "DELIVERY_START" | "LEGACY_PICKUP" = "DELIVERY_START",
) {
  const windows = await database
    .prepare(`SELECT w.id windowId,w.name,w.starts_at startsAt,w.ends_at endsAt,s.pickup_at pickupAt,s.preparation_at preparationAt,s.timezone
    FROM delivery_cycle_window w JOIN delivery_cycle_schedule s ON s.cycle_id=w.cycle_id
    WHERE w.cycle_id=? AND (? IS NULL OR w.id=?) ORDER BY w.starts_at,w.id LIMIT 2`)
    .bind(cycleId, windowId ?? null, windowId ?? null)
    .all<{
      windowId: string;
      name: string;
      startsAt: number;
      endsAt: number;
      pickupAt: number;
      preparationAt: number;
      timezone: string;
    }>();
  const window = windows.results[0];
  if (
    !window ||
    windows.results.length !== 1 ||
    window.startsAt < window.preparationAt ||
    window.endsAt <= window.startsAt
  )
    return null;
  return {
    windowId: window.windowId,
    name: window.name,
    timezone: window.timezone,
    startsAt: new Date(window.startsAt).toISOString(),
    endsAt: new Date(window.endsAt).toISOString(),
    pickupAt: new Date(
      quotationTiming === "DELIVERY_START" ? window.startsAt : window.pickupAt,
    ).toISOString(),
    ...(quotationTiming === "DELIVERY_START" ? { quotationTiming } : {}),
  };
}
export function scheduledWindowGuard(
  database: D1Database,
  cycleId: string,
  window: ScheduledWindowSnapshot,
) {
  return database
    .prepare(`INSERT INTO commitment_abort(id) SELECT -26 WHERE NOT EXISTS (
    SELECT 1 FROM delivery_cycle_window w JOIN delivery_cycle_schedule s ON s.cycle_id=w.cycle_id
    WHERE w.cycle_id=? AND w.id=? AND w.name=? AND w.starts_at=? AND w.ends_at=?
      AND ${window.quotationTiming === "DELIVERY_START" ? "w.starts_at" : "s.pickup_at"}=? AND s.timezone=?
      AND s.preparation_at<=w.starts_at)`)
    .bind(
      cycleId,
      window.windowId,
      window.name,
      Date.parse(window.startsAt),
      Date.parse(window.endsAt),
      Date.parse(window.pickupAt),
      window.timezone,
    );
}
