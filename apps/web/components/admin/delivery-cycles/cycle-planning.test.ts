import { describe, expect, it } from "vitest";
import type { AdminDeliveryCycleView, DeliveryCycleDraft } from "@freshmarkets/contracts";
import { cycleToCalendarEvents } from "./cycle-calendar-adapter";
import {
  businessFieldsToInstant,
  deliveryDateForPlanningRange,
  instantToBusinessFields,
  shiftInstantToDeliveryDate,
  suggestedCycleSchedule,
  suggestedDeliveryWindow,
} from "./cycle-time";
import { validateCycleDraft } from "./cycle-validation";

const timezone = "Asia/Manila";
const cycle: AdminDeliveryCycleView = {
  cycleId: "cycle-1",
  marketId: "market-1",
  marketName: "Metro Cebu",
  name: "Saturday delivery",
  status: "DRAFT",
  version: 1,
  cancellationUnavailableReason: null,
  timezone,
  orderOpensAt: "2026-09-21T00:00:00Z",
  cutoffAt: "2026-09-25T09:00:00Z",
  procurementAt: "2026-09-25T21:00:00Z",
  preparationAt: "2026-09-25T22:00:00Z",
  pickupAt: "2026-09-26T00:30:00Z",
  windows: [
    {
      windowId: "window-1",
      name: "Scheduled delivery",
      startsAt: "2026-09-26T01:00:00Z",
      endsAt: "2026-09-26T04:00:00Z",
    },
  ],
  participation: [
    {
      zoneId: "zone-1",
      zoneName: "Central",
      locationId: "location-1",
      locationName: "Central Cebu",
    },
  ],
};

function draft(): DeliveryCycleDraft {
  return {
    marketId: cycle.marketId,
    name: cycle.name,
    orderOpensAt: cycle.orderOpensAt,
    cutoffAt: cycle.cutoffAt,
    procurementAt: cycle.procurementAt!,
    preparationAt: cycle.preparationAt!,
    windows: cycle.windows,
    participation: [{ zoneId: "zone-1", locationId: "location-1" }],
    expectedVersion: 0,
    reason: "Plan weekly delivery",
  };
}

describe("cycle planning presentation", () => {
  it("keeps business-time inputs independent from the device timezone", () => {
    expect(instantToBusinessFields("2026-09-26T01:00:00Z", timezone)).toEqual({
      date: "2026-09-26",
      time: "09:00",
    });
    expect(businessFieldsToInstant({ date: "2026-09-26", time: "09:00" }, timezone)).toBe(
      "2026-09-26T01:00:00Z",
    );
  });

  it("shifts a duplicate relative to its delivery date without changing its business time", () => {
    expect(
      shiftInstantToDeliveryDate(cycle.orderOpensAt, "2026-09-26", "2026-10-03", timezone),
    ).toBe("2026-09-28T00:00:00Z");
  });

  it("defaults an October 9–16 drag to Friday cutoff and Saturday–Sunday delivery", () => {
    // FullCalendar's end is exclusive: dragging through October 16 gives October 17.
    const deliveryDate = deliveryDateForPlanningRange("2026-10-09", "2026-10-17");
    const schedule = suggestedCycleSchedule(deliveryDate, timezone, "2026-10-09");
    const window = suggestedDeliveryWindow(deliveryDate, timezone);
    expect(
      Object.fromEntries(
        Object.entries(schedule).map(([field, instant]) => [
          field,
          instantToBusinessFields(instant, timezone),
        ]),
      ),
    ).toEqual({
      orderOpensAt: { date: "2026-10-09", time: "00:00" },
      cutoffAt: { date: "2026-10-16", time: "00:00" },
      procurementAt: { date: "2026-10-16", time: "00:00" },
      preparationAt: { date: "2026-10-16", time: "00:00" },
    });
    expect(instantToBusinessFields(window.startsAt, timezone)).toEqual({
      date: "2026-10-17",
      time: "00:00",
    });
    expect(instantToBusinessFields(window.endsAt, timezone)).toEqual({
      date: "2026-10-18",
      time: "23:59",
    });
    expect(
      validateCycleDraft(
        { ...draft(), ...schedule, windows: [window] },
        Date.parse("2026-10-08T00:00:00Z"),
      ),
    ).toEqual({});
  });

  it.each([
    ["2026-10-17", "2026-10-09", "2026-10-16", "2026-10-18"],
    ["2026-11-01", "2026-10-24", "2026-10-31", "2026-11-02"],
    ["2027-01-01", "2026-12-24", "2026-12-31", "2027-01-02"],
  ])(
    "uses a seven-day ordering period and two delivery dates across calendar boundaries for %s",
    (date, openingDate, cutoffDate, endDate) => {
      const schedule = suggestedCycleSchedule(date, timezone);
      const window = suggestedDeliveryWindow(date, timezone);
      expect(instantToBusinessFields(schedule.orderOpensAt, timezone)).toEqual({
        date: openingDate,
        time: "00:00",
      });
      for (const instant of [schedule.cutoffAt, schedule.procurementAt, schedule.preparationAt])
        expect(instantToBusinessFields(instant, timezone)).toEqual({
          date: cutoffDate,
          time: "00:00",
        });
      expect(instantToBusinessFields(window.startsAt, timezone)).toEqual({
        date: date,
        time: "00:00",
      });
      expect(instantToBusinessFields(window.endsAt, timezone)).toEqual({
        date: endDate,
        time: "23:59",
      });
      expect(Date.parse(window.endsAt)).toBeGreaterThan(Date.parse(window.startsAt));
    },
  );

  it("keeps a single-day calendar selection as delivery day", () => {
    expect(deliveryDateForPlanningRange("2026-10-17", "2026-10-18")).toBe("2026-10-17");
    expect(deliveryDateForPlanningRange("2026-10-30", "2026-11-01")).toBe("2026-11-01");
  });

  it("shows a compact connected cycle in month and exact markers in agenda", () => {
    const month = cycleToCalendarEvents(cycle, "month");
    expect(month.map((event) => event.extendedProps.kind)).toEqual(["ordering", "delivery"]);
    expect(month.every((event) => event.extendedProps.cycleId === cycle.cycleId)).toBe(true);
    const agenda = cycleToCalendarEvents(cycle, "agenda");
    expect(agenda.map((event) => event.extendedProps.kind)).toEqual([
      "orders-open",
      "cutoff",
      "procurement",
      "preparation",
      "delivery",
    ]);
  });

  it("keeps equal intermediate milestones legal and reports actionable chronology errors", () => {
    const equal = draft();
    equal.procurementAt = equal.cutoffAt;
    equal.preparationAt = equal.cutoffAt;
    equal.windows = [{ ...equal.windows[0]!, startsAt: equal.cutoffAt }];
    expect(validateCycleDraft(equal, Date.parse("2026-09-20T00:00:00Z"))).toEqual({});

    const invalid = draft();
    invalid.preparationAt = "2026-09-25T20:00:00Z";
    invalid.windows = [{ ...invalid.windows[0]!, startsAt: "2026-09-25T19:00:00Z" }];
    expect(validateCycleDraft(invalid, Date.parse("2026-09-20T00:00:00Z"))).toMatchObject({
      preparationAt: "Preparation cannot start before procurement.",
      deliveryStartsAt: "Delivery must start at or after preparation starts.",
    });
  });
});
