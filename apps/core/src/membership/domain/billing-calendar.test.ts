import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calculateCalendarMonthEnd,
  calendarDayOfMonth,
  InvalidBillingAnchorError,
  InvalidInstantError,
  InvalidTimezoneError,
  nextBillingPeriodEnd,
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

describe("calendar day-of-month and calendar-day arithmetic", () => {
  it("reads the local calendar day of an instant", () => {
    // 2026-01-31 10:30 Manila is 02:30 UTC on the 31st; late UTC is next day.
    expect(calendarDayOfMonth("2026-01-31T02:30:00.000Z", "Asia/Manila")).toBe(31);
    expect(calendarDayOfMonth("2026-01-31T16:30:00.000Z", "Asia/Manila")).toBe(1);
  });

  it("adds calendar days preserving the local wall clock", () => {
    // 7-calendar-day grace: failure Feb 25 18:00 Manila -> Mar 4 18:00 Manila.
    expect(addCalendarDays("2026-02-25T10:00:00.000Z", 7, "Asia/Manila")).toBe(
      "2026-03-04T10:00:00.000Z",
    );
    // Crosses a month boundary clamped at Feb 28.
    expect(addCalendarDays("2026-02-25T10:00:00.000Z", 4, "Asia/Manila")).toBe(
      "2026-03-01T10:00:00.000Z",
    );
  });

  it("rejects invalid calendar-day inputs like the month helpers", () => {
    expect(() => addCalendarDays("not-an-instant", 7, "Asia/Manila")).toThrow(InvalidInstantError);
    expect(() => addCalendarDays("2026-02-25T10:00:00.000Z", 7, "Mars/Olympus_Mons")).toThrow(
      InvalidTimezoneError,
    );
  });
});

describe("nominal billing anchor period arithmetic", () => {
  it("returns the next anchor occurrence strictly after the boundary", () => {
    // Anchor 15: a period ending Mar 10 re-bills Mar 15 at the same wall time.
    expect(nextBillingPeriodEnd(15, "2026-03-10T02:30:00.000Z", "Asia/Manila")).toBe(
      "2026-03-15T02:30:00.000Z",
    );
  });

  it("clamps the anchor into short months and re-expands afterwards", () => {
    // Anchor 31: period that ended Feb 28 re-bills Mar 31 (not Mar 28).
    expect(nextBillingPeriodEnd(31, "2026-02-28T02:30:00.000Z", "Asia/Manila")).toBe(
      "2026-03-31T02:30:00.000Z",
    );
    // Anchor 31 after Jan 31 clamps into February as Feb 28.
    expect(nextBillingPeriodEnd(31, "2026-01-31T02:30:00.000Z", "Asia/Manila")).toBe(
      "2026-02-28T02:30:00.000Z",
    );
    // Leap year clamps to Feb 29.
    expect(nextBillingPeriodEnd(31, "2028-01-31T02:30:00.000Z", "Asia/Manila")).toBe(
      "2028-02-29T02:30:00.000Z",
    );
  });

  it("skips the anchor day when the boundary already sits on it", () => {
    // Anchor 28 with the period ending exactly Feb 28 bills Mar 28 next.
    expect(nextBillingPeriodEnd(28, "2026-02-28T02:30:00.000Z", "Asia/Manila")).toBe(
      "2026-03-28T02:30:00.000Z",
    );
  });

  it("preserves the local wall clock across a DST shift", () => {
    expect(nextBillingPeriodEnd(15, "2026-03-01T05:00:00.000Z", "America/New_York")).toBe(
      "2026-03-15T04:00:00.000Z",
    );
  });

  it("rejects invalid anchors, instants, and timezones", () => {
    expect(() => nextBillingPeriodEnd(0, "2026-03-01T00:00:00.000Z", "Asia/Manila")).toThrow(
      InvalidBillingAnchorError,
    );
    expect(() => nextBillingPeriodEnd(32, "2026-03-01T00:00:00.000Z", "Asia/Manila")).toThrow(
      InvalidBillingAnchorError,
    );
    expect(() =>
      nextBillingPeriodEnd("15" as never, "2026-03-01T00:00:00.000Z", "Asia/Manila"),
    ).toThrow(InvalidBillingAnchorError);
    expect(() => nextBillingPeriodEnd(15, "not-an-instant", "Asia/Manila")).toThrow(
      InvalidInstantError,
    );
    expect(() => nextBillingPeriodEnd(15, "2026-03-01T00:00:00.000Z", "Mars/Olympus_Mons")).toThrow(
      InvalidTimezoneError,
    );
  });
});
