import { describe, expect, it } from "vitest";
import {
  calculateCalendarMonthEnd,
  InvalidInstantError,
  InvalidTimezoneError,
} from "./billing-calendar";

describe("calendar month trial arithmetic", () => {
  it("clamps month-end dates to the constrained local calendar month", () => {
    // Jan 31 10:30 Manila -> Feb 28 10:30 Manila
    expect(calculateCalendarMonthEnd("2026-01-31T02:30:00.000Z", "Asia/Manila")).toBe(
      "2026-02-28T02:30:00.000Z",
    );
    // Leap year: Jan 31 10:30 Manila -> Feb 29 10:30 Manila
    expect(calculateCalendarMonthEnd("2028-01-31T02:30:00.000Z", "Asia/Manila")).toBe(
      "2028-02-29T02:30:00.000Z",
    );
    // Mar 31 00:30 Manila -> Apr 30 00:30 Manila
    expect(calculateCalendarMonthEnd("2026-03-30T16:30:00.000Z", "Asia/Manila")).toBe(
      "2026-04-29T16:30:00.000Z",
    );
  });

  it("preserves wall-clock time across DST transitions", () => {
    // New York starts on Mar 1 00:00 EST (UTC-5) and lands on Apr 1 00:00 EDT
    // (UTC-4): the local wall clock is preserved, the UTC offset shifts.
    expect(calculateCalendarMonthEnd("2026-03-01T05:00:00.000Z", "America/New_York")).toBe(
      "2026-04-01T04:00:00.000Z",
    );
  });

  it("keeps ordinary dates on the same zoned wall clock one month later", () => {
    expect(calculateCalendarMonthEnd("2026-06-15T01:15:00.000Z", "Asia/Manila")).toBe(
      "2026-07-15T01:15:00.000Z",
    );
  });

  it("rejects invalid instants and unknown timezones", () => {
    expect(() => calculateCalendarMonthEnd("not-an-instant", "Asia/Manila")).toThrow(
      InvalidInstantError,
    );
    expect(() =>
      calculateCalendarMonthEnd("2026-06-15T01:15:00.000Z", "Mars/Olympus_Mons"),
    ).toThrow(InvalidTimezoneError);
  });
});
