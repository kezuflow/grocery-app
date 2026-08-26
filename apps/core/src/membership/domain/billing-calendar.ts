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

/**
 * One constrained calendar month after the given UTC instant, evaluated in the
 * market business timezone with wall-clock preservation, returned as a UTC ISO
 * instant. Never fixed-day or millisecond arithmetic.
 */
export function calculateCalendarMonthEnd(trialStartsAt: string, timeZone: string): string {
  let start: Temporal.Instant;
  try {
    start = Temporal.Instant.from(trialStartsAt);
  } catch {
    throw new InvalidInstantError();
  }
  let zoned: Temporal.ZonedDateTime;
  try {
    zoned = start.toZonedDateTimeISO(timeZone);
  } catch {
    throw new InvalidTimezoneError(timeZone);
  }
  return zoned
    .add({ months: 1 }, { overflow: "constrain" })
    .toInstant()
    .toString({ fractionalSecondDigits: 3 });
}
