import { locationOperatingScheduleSchema } from "@freshmarkets/validation";
import { operatingInterval } from "../operating-schedule";
import type { OperationalCandidate } from "./operational-candidates";

export function scheduledOperatingInterval(candidate: OperationalCandidate, pickupAt: number) {
  return operatingInterval(
    locationOperatingScheduleSchema.parse(JSON.parse(candidate.scheduleJson)),
    candidate.scheduleTimezone,
    pickupAt,
  );
}
export function operatingScheduleGuard(
  database: D1Database,
  candidate: OperationalCandidate,
  interval: { startsAt: number; endsAt: number },
  pickupAt?: number,
) {
  return database
    .prepare(`INSERT INTO commitment_abort(id) SELECT -26 WHERE NOT EXISTS (
    SELECT 1 FROM location_operating_schedule s WHERE s.location_id=? AND s.definition_json=? AND s.timezone=?)
    OR COALESCE(?,CAST(unixepoch('subsec')*1000 AS INTEGER))<? OR COALESCE(?,CAST(unixepoch('subsec')*1000 AS INTEGER))>=?`)
    .bind(
      candidate.locationId,
      candidate.scheduleJson,
      candidate.scheduleTimezone,
      pickupAt ?? null,
      interval.startsAt,
      pickupAt ?? null,
      interval.endsAt,
    );
}
