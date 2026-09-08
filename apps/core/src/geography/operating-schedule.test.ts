import { describe, it, expect } from "vitest";
import {
  operatingInterval,
  validateOperatingSchedule,
  nextOperatingBoundary,
} from "./operating-schedule";
const weekly = [{ dayOfWeek: 2, opensMinute: 540, closesMinute: 1020 }];
describe("operating schedule", () => {
  it("bounds routing evidence by a currently closed site's next opening", () => {
    const opening = Date.parse("2026-09-08T01:00:00Z");
    expect(nextOperatingBoundary({ weekly, closures: [] }, "Asia/Manila", opening - 1)).toBe(
      opening,
    );
    expect(nextOperatingBoundary({ weekly, closures: [] }, "Asia/Manila", opening)).toBe(
      Date.parse("2026-09-08T09:00:00Z"),
    );
  });
  it("uses local weekday and exact opening/closing boundaries", () => {
    const start = Date.parse("2026-09-08T01:00:00Z"),
      end = Date.parse("2026-09-08T09:00:00Z");
    expect(operatingInterval({ weekly, closures: [] }, "Asia/Manila", start - 1)).toBeNull();
    expect(operatingInterval({ weekly, closures: [] }, "Asia/Manila", start)).toEqual({
      startsAt: start,
      endsAt: end,
    });
    expect(operatingInterval({ weekly, closures: [] }, "Asia/Manila", end - 1)).not.toBeNull();
    expect(operatingInterval({ weekly, closures: [] }, "Asia/Manila", end)).toBeNull();
  });
  it("splits the open interval around a closure, including exact boundaries", () => {
    const start = Date.parse("2026-09-08T03:00:00Z"),
      end = Date.parse("2026-09-08T04:00:00Z");
    const schedule = {
      weekly,
      closures: [
        {
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
          reason: "Maintenance",
        },
      ],
    };
    expect(operatingInterval(schedule, "Asia/Manila", start - 1)?.endsAt).toBe(start);
    expect(operatingInterval(schedule, "Asia/Manila", start)).toBeNull();
    expect(operatingInterval(schedule, "Asia/Manila", end - 1)).toBeNull();
    expect(operatingInterval(schedule, "Asia/Manila", end)?.startsAt).toBe(end);
  });
  it("preserves local hours across daylight saving and midnight", () => {
    const schedule = {
      weekly: [{ dayOfWeek: 7, opensMinute: 0, closesMinute: 1440 }],
      closures: [],
    };
    const open = operatingInterval(
      schedule,
      "America/New_York",
      Date.parse("2026-03-08T12:00:00Z"),
    );
    expect(open && open.endsAt - open.startsAt).toBe(23 * 3600000);
  });
  it("rejects overlaps and reversed intervals while allowing closed days", () => {
    expect(validateOperatingSchedule({ weekly: [], closures: [] })).toBeNull();
    expect(validateOperatingSchedule({ weekly: [...weekly, ...weekly], closures: [] })).toMatch(
      /overlap/,
    );
    expect(
      validateOperatingSchedule({
        weekly: [{ dayOfWeek: 2, opensMinute: 1200, closesMinute: 200 }],
        closures: [],
      }),
    ).toMatch(/Closing/);
  });
});
