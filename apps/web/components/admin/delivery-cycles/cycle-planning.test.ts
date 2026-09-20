import { describe, expect, it } from "vitest";
import type { AdminDeliveryCycleView, DeliveryCycleDraft } from "@freshmarkets/contracts";
import { cycleToCalendarEvents } from "./cycle-calendar-adapter";
import {
  businessFieldsToInstant,
  instantToBusinessFields,
  shiftInstantToDeliveryDate,
  suggestedCycleSchedule,
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
    pickupAt: cycle.pickupAt!,
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

  it("suggests a full ordering day followed by spaced fulfillment milestones", () => {
    const schedule = suggestedCycleSchedule("2026-09-26", timezone, "2026-09-21");
    expect(
      Object.fromEntries(
        Object.entries(schedule).map(([field, instant]) => [
          field,
          instantToBusinessFields(instant, timezone),
        ]),
      ),
    ).toEqual({
      orderOpensAt: { date: "2026-09-21", time: "00:00" },
      cutoffAt: { date: "2026-09-25", time: "23:59" },
      procurementAt: { date: "2026-09-26", time: "00:00" },
      preparationAt: { date: "2026-09-26", time: "02:00" },
      pickupAt: { date: "2026-09-26", time: "04:00" },
    });
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
      "pickup",
      "delivery",
    ]);
  });

  it("keeps equal intermediate milestones legal and reports actionable chronology errors", () => {
    const equal = draft();
    equal.procurementAt = equal.cutoffAt;
    equal.preparationAt = equal.cutoffAt;
    equal.pickupAt = equal.cutoffAt;
    equal.windows = [{ ...equal.windows[0]!, startsAt: equal.cutoffAt }];
    expect(validateCycleDraft(equal, Date.parse("2026-09-20T00:00:00Z"))).toEqual({});

    const invalid = draft();
    invalid.preparationAt = "2026-09-25T20:00:00Z";
    invalid.windows = [{ ...invalid.windows[0]!, startsAt: "2026-09-26T00:00:00Z" }];
    expect(validateCycleDraft(invalid, Date.parse("2026-09-20T00:00:00Z"))).toMatchObject({
      preparationAt: "Preparation cannot start before procurement.",
      deliveryStartsAt: "Delivery must start at or after the planned pickup.",
    });
  });
});
