import { Temporal } from "temporal-polyfill";

export class InvalidInstantError extends Error {
  constructor() {
    super("INVALID_INSTANT");
    this.name = "InvalidInstantError";
  }
}

export class InvalidTimezoneError extends Error {
  constructor(timeZone: string) {
    super(`INVALID_TIMEZONE: ${timeZone}`);
    this.name = "InvalidTimezoneError";
  }
}

export class InvalidBillingAnchorError extends Error {
  constructor(anchorDay: unknown) {
    super(`INVALID_BILLING_ANCHOR: ${String(anchorDay)}`);
    this.name = "InvalidBillingAnchorError";
  }
}

function toZoned(instantIso: string, timeZone: string): Temporal.ZonedDateTime {
  let start: Temporal.Instant;
  try {
    start = Temporal.Instant.from(instantIso);
  } catch {
    throw new InvalidInstantError();
  }
  try {
    return start.toZonedDateTimeISO(timeZone);
  } catch {
    throw new InvalidTimezoneError(timeZone);
  }
}

function toInstantString(zoned: Temporal.ZonedDateTime): string {
  return zoned.toInstant().toString({ fractionalSecondDigits: 3 });
}

/**
 * One constrained calendar month after the given UTC instant, evaluated in the
 * market business timezone with wall-clock preservation, returned as a UTC ISO
 * instant. Never fixed-day or millisecond arithmetic.
 */
export function calculateCalendarMonthEnd(trialStartsAt: string, timeZone: string): string {
  const zoned = toZoned(trialStartsAt, timeZone);
  return toInstantString(zoned.add({ months: 1 }, { overflow: "constrain" }));
}

/** Local calendar day-of-month (1-31) of the instant in the timezone. */
export function calendarDayOfMonth(instantIso: string, timeZone: string): number {
  return toZoned(instantIso, timeZone).day;
}

/**
 * Exactly `days` calendar days after the instant, local wall clock preserved.
 * Used for the 7-calendar-day PAST_DUE grace window.
 */
export function addCalendarDays(instantIso: string, days: number, timeZone: string): string {
  if (!Number.isInteger(days) || days <= 0) throw new InvalidInstantError();
  return toInstantString(toZoned(instantIso, timeZone).add({ days }, { overflow: "constrain" }));
}

/**
 * The earliest instant strictly after `afterInstantIso` whose local calendar
 * day equals the nominal billing anchor, clamped into shorter months. The
 * nominal anchor survives clamping and re-expands in later longer months, so a
 * Jan-31 anchor bills Feb 28 then Mar 31, never a permanent drift to 28.
 */
export function nextBillingPeriodEnd(
  anchorDay: number,
  afterInstantIso: string,
  timeZone: string,
): string {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31)
    throw new InvalidBillingAnchorError(anchorDay);
  const after = toZoned(afterInstantIso, timeZone);
  const afterDate = after.toPlainDate();
  const startMonth = afterDate.toPlainYearMonth();
  for (let monthOffset = 0; ; monthOffset += 1) {
    const yearMonth = startMonth.add({ months: monthOffset });
    const candidateDate = Temporal.PlainDate.from(
      { year: yearMonth.year, monthCode: yearMonth.monthCode, day: anchorDay },
      { overflow: "constrain" },
    );
    if (Temporal.PlainDate.compare(candidateDate, afterDate) > 0) {
      return toInstantString(
        candidateDate.toZonedDateTime({ timeZone, plainTime: after.toPlainTime() }),
      );
    }
  }
}
