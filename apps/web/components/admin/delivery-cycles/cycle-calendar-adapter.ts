import type { EventInput } from "@fullcalendar/react";
import type { AdminDeliveryCycleView, DeliveryCycleDraft } from "@freshmarkets/contracts";
import { addBusinessDays, instantToBusinessDate } from "./cycle-time";

export type CycleCalendarElementKind =
  | "ordering"
  | "orders-open"
  | "cutoff"
  | "procurement"
  | "preparation"
  | "pickup"
  | "delivery";

export type CycleCalendarEvent = EventInput & {
  id: string;
  extendedProps: {
    cycleId: string;
    kind: CycleCalendarElementKind;
    draft: boolean;
  };
};

type CalendarCycle = Pick<
  AdminDeliveryCycleView,
  | "cycleId"
  | "name"
  | "timezone"
  | "orderOpensAt"
  | "cutoffAt"
  | "procurementAt"
  | "preparationAt"
  | "pickupAt"
  | "windows"
>;

const milestoneLabels = {
  orderOpensAt: ["Orders open", "orders-open"],
  cutoffAt: ["Order cutoff", "cutoff"],
  procurementAt: ["Procurement starts", "procurement"],
  preparationAt: ["Preparation starts", "preparation"],
  pickupAt: ["Planned pickup", "pickup"],
} as const;

export function cycleToCalendarEvents(
  cycle: CalendarCycle,
  detail: "month" | "week" | "agenda",
  draft = false,
): CycleCalendarEvent[] {
  const className = draft ? "fm-cycle-event fm-cycle-event-preview" : "fm-cycle-event";
  const events: CycleCalendarEvent[] = [];
  if (detail !== "agenda") {
    const cutoffDate = instantToBusinessDate(cycle.cutoffAt, cycle.timezone);
    events.push({
      id: `${cycle.cycleId}:ordering`,
      groupId: cycle.cycleId,
      title: `${cycle.name} · Ordering open`,
      start: instantToBusinessDate(cycle.orderOpensAt, cycle.timezone),
      end: addBusinessDays(cutoffDate, 1),
      allDay: true,
      interactive: true,
      className,
      extendedProps: { cycleId: cycle.cycleId, kind: "ordering", draft },
    });
  }
  if (detail !== "month") {
    for (const [field, [title, kind]] of Object.entries(milestoneLabels) as Array<
      [keyof typeof milestoneLabels, (typeof milestoneLabels)[keyof typeof milestoneLabels]]
    >) {
      const start = cycle[field];
      if (!start) continue;
      events.push({
        id: `${cycle.cycleId}:${kind}`,
        groupId: cycle.cycleId,
        title,
        start,
        interactive: true,
        className,
        extendedProps: { cycleId: cycle.cycleId, kind, draft },
      });
    }
  }
  for (const [index, window] of cycle.windows.entries())
    events.push({
      id: `${cycle.cycleId}:delivery:${index}`,
      groupId: cycle.cycleId,
      title: `${cycle.name} · Customer delivery`,
      start: window.startsAt,
      end: window.endsAt,
      interactive: true,
      className: `${className} fm-cycle-event-delivery`,
      extendedProps: { cycleId: cycle.cycleId, kind: "delivery", draft },
    });
  return events;
}

export function cyclesToCalendarEvents(
  cycles: readonly AdminDeliveryCycleView[],
  detail: "month" | "week" | "agenda",
  draft?: { value: DeliveryCycleDraft; timezone: string } | null,
): CycleCalendarEvent[] {
  const saved = cycles.flatMap((cycle) => cycleToCalendarEvents(cycle, detail));
  if (!draft) return saved;
  const window = draft.value.windows[0];
  if (!draft.value.orderOpensAt || !draft.value.cutoffAt || !window?.startsAt || !window.endsAt)
    return saved;
  return [
    ...saved,
    ...cycleToCalendarEvents(
      {
        cycleId: "unsaved-preview",
        name: draft.value.name || "Unsaved cycle",
        timezone: draft.timezone,
        orderOpensAt: draft.value.orderOpensAt,
        cutoffAt: draft.value.cutoffAt,
        procurementAt: draft.value.procurementAt || null,
        preparationAt: draft.value.preparationAt || null,
        pickupAt: draft.value.pickupAt || null,
        windows: [{ windowId: "unsaved-window", ...window }],
      },
      detail,
      true,
    ),
  ];
}
