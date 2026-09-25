import type { StorefrontAnnouncementSchedule } from "@freshmarkets/contracts";

type CycleWindow = {
  orderOpensAt: number;
  cutoffAt: number;
  startsAt: number;
  endsAt: number;
  timezone: string;
};

function weekday(epochMs: number, timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(
      new Date(epochMs),
    );
  } catch {
    return null;
  }
}

export function supportsMondayFridaySundayCopy(window: CycleWindow): boolean {
  return (
    weekday(window.orderOpensAt, window.timezone) === "Monday" &&
    weekday(window.cutoffAt - 1, window.timezone) === "Friday" &&
    weekday(window.startsAt, window.timezone) === "Sunday" &&
    weekday(window.endsAt - 1, window.timezone) === "Sunday"
  );
}

/** Marketing copy follows current Core facts; it never admits checkout or promises a quote. */
export async function readStorefrontAnnouncementSchedule(
  db: Pick<D1Database, "prepare">,
  nowMs: number,
): Promise<StorefrontAnnouncementSchedule> {
  const configuration = await db
    .prepare(
      "SELECT fulfillment_mode mode,selling_state sellingState FROM global_commerce_configuration WHERE id='global'",
    )
    .first<{ mode: string; sellingState: string }>();
  if (configuration?.mode !== "SCHEDULED" || configuration.sellingState !== "OPEN")
    return "GENERAL";

  // A single public message must be true for every currently offered Scheduled cycle.
  const cycles = await db
    .prepare(
      `SELECT c.order_opens_at orderOpensAt,c.cutoff_at cutoffAt,
         w.starts_at startsAt,w.ends_at endsAt,s.timezone
       FROM delivery_cycle c
       JOIN delivery_cycle_schedule s ON s.cycle_id=c.id
       JOIN delivery_cycle_window w ON w.cycle_id=c.id
       WHERE c.status='OPEN' AND c.order_opens_at<=? AND c.cutoff_at>?
         AND EXISTS (
           SELECT 1 FROM delivery_cycle_zone z
           WHERE z.cycle_id=c.id AND z.status='ACTIVE'
         )
       ORDER BY c.id,w.starts_at LIMIT 32`,
    )
    .bind(nowMs, nowMs)
    .all<CycleWindow>();

  if (cycles.results.length === 0 || cycles.results.length === 32) return "GENERAL";
  return cycles.results.every(supportsMondayFridaySundayCopy) ? "MONDAY_FRIDAY_SUNDAY" : "GENERAL";
}
