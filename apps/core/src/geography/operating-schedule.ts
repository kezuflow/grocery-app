import { Temporal } from "temporal-polyfill";
import type { LocationOperatingSchedule } from "@freshmarkets/contracts";

export function validateOperatingSchedule(schedule: LocationOperatingSchedule): string | null {
  const weekly = [...schedule.weekly].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.opensMinute - b.opensMinute,
  );
  for (const [index, interval] of weekly.entries()) {
    if (interval.opensMinute >= interval.closesMinute)
      return "Closing time must follow opening time; split overnight hours across days";
    const prior = weekly[index - 1];
    if (prior?.dayOfWeek === interval.dayOfWeek && prior.closesMinute > interval.opensMinute)
      return "Weekly operating intervals must not overlap";
  }
  for (const closure of schedule.closures) {
    if (Date.parse(closure.startsAt) >= Date.parse(closure.endsAt))
      return "Closure end must follow its start";
  }
  return null;
}

/** Conservative validity horizon for a routing read, including a currently closed site's opening. */
export function nextOperatingBoundary(
  schedule: LocationOperatingSchedule,
  timezone: string,
  target: number,
): number {
  const local = Temporal.Instant.fromEpochMilliseconds(target).toZonedDateTimeISO(timezone);
  const midnight = local.toPlainDate().toZonedDateTime(timezone);
  let boundary = midnight.add({ days: 1 }).epochMilliseconds;
  for (const interval of schedule.weekly) {
    if (interval.dayOfWeek !== local.dayOfWeek) continue;
    for (const minute of [interval.opensMinute, interval.closesMinute]) {
      const at =
        minute === 1440
          ? boundary
          : midnight.with({ hour: Math.floor(minute / 60), minute: minute % 60 }).epochMilliseconds;
      if (at > target) boundary = Math.min(boundary, at);
    }
  }
  for (const closure of schedule.closures)
    for (const instant of [closure.startsAt, closure.endsAt]) {
      const at = Date.parse(instant);
      if (at > target) boundary = Math.min(boundary, at);
    }
  return boundary;
}

/** An open interval containing the target. End is exclusive; closures always take precedence. */
export function operatingInterval(
  schedule: LocationOperatingSchedule,
  timezone: string,
  target: number,
): { startsAt: number; endsAt: number } | null {
  const local = Temporal.Instant.fromEpochMilliseconds(target).toZonedDateTimeISO(timezone);
  for (const interval of schedule.weekly) {
    if (interval.dayOfWeek !== local.dayOfWeek) continue;
    const midnight = local.toPlainDate().toZonedDateTime(timezone);
    const instantAt = (minute: number) =>
      minute === 1440
        ? midnight.add({ days: 1 }).epochMilliseconds
        : midnight.with({ hour: Math.floor(minute / 60), minute: minute % 60 }).epochMilliseconds;
    let startsAt = instantAt(interval.opensMinute),
      endsAt = instantAt(interval.closesMinute);
    if (target < startsAt || target >= endsAt) continue;
    for (const closure of schedule.closures) {
      const start = Date.parse(closure.startsAt),
        end = Date.parse(closure.endsAt);
      if (target >= start && target < end) return null;
      if (end <= target) startsAt = Math.max(startsAt, end);
      if (start > target) endsAt = Math.min(endsAt, start);
    }
    return { startsAt, endsAt };
  }
  return null;
}
