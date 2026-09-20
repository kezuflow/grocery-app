"use client";

import { useEffect, useMemo, useState } from "react";
import FullCalendar, {
  useCalendarController,
  type DateClickInfo,
  type DatesSetInfo,
  type EventClickInfo,
  type EventDisplayInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import pulseThemePlugin from "@fullcalendar/react/themes/pulse";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import type { AdminDeliveryCycleView, DeliveryCycleDraft } from "@freshmarkets/contracts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cyclesToCalendarEvents, type CycleCalendarElementKind } from "./cycle-calendar-adapter";

export type CycleCalendarView = "month" | "week" | "agenda";

function viewName(type: string): CycleCalendarView {
  if (type === "timeGridWeek") return "week";
  if (type === "listMonth") return "agenda";
  return "month";
}

const kindLabels: Record<CycleCalendarElementKind, string> = {
  ordering: "Ordering window",
  "orders-open": "Orders open",
  cutoff: "Order cutoff",
  procurement: "Procurement",
  preparation: "Preparation",
  pickup: "Planned pickup",
  delivery: "Customer delivery",
};

export function CycleCalendar({
  cycles,
  timezone,
  selectedCycleId,
  draft,
  loading,
  rangeIncomplete,
  onRangeChange,
  onSelectCycle,
  onEmptyDate,
  onRefresh,
}: {
  cycles: readonly AdminDeliveryCycleView[];
  timezone: string;
  selectedCycleId: string | null;
  draft: DeliveryCycleDraft | null;
  loading: boolean;
  rangeIncomplete: boolean;
  onRangeChange(info: DatesSetInfo): void;
  onSelectCycle(cycleId: string): void;
  onEmptyDate(date: string): void;
  onRefresh(): void;
}) {
  const controller = useCalendarController();
  const [view, setView] = useState<CycleCalendarView>("month");
  const events = useMemo(
    () => cyclesToCalendarEvents(cycles, view, draft ? { value: draft, timezone } : null),
    [cycles, draft, timezone, view],
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    if (query.matches) controller.changeView("listMonth");
  }, [controller]);
  const changeView = (next: CycleCalendarView) => {
    controller.changeView(
      next === "month" ? "dayGridMonth" : next === "week" ? "timeGridWeek" : "listMonth",
    );
  };
  const eventClass = (info: EventDisplayInfo) =>
    cn(
      "fm-cycle-event",
      info.event.groupId === selectedCycleId && "fm-cycle-event-selected",
      info.event.extendedProps.draft && "fm-cycle-event-preview",
      info.event.extendedProps.kind === "delivery" && "fm-cycle-event-delivery",
    );
  return (
    <section
      aria-label="Scheduled cycle calendar"
      className="min-w-0 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]"
    >
      <div className="flex flex-col gap-3 border-b border-[var(--fm-border)] p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => controller.today()}>
            Today
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Previous calendar period"
            onClick={() => controller.prev()}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <h2 aria-live="polite" className="min-w-40 px-2 text-base font-semibold">
            {controller.view?.title ?? "Schedule"}
          </h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Next calendar period"
            onClick={() => controller.next()}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Refresh visible calendar range"
            disabled={loading}
            onClick={onRefresh}
          >
            <RotateCw aria-hidden className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <div
            role="group"
            aria-label="Calendar view"
            className="flex rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-muted)] p-0.5"
          >
            {(["month", "week", "agenda"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={view === option}
                className={cn(
                  "h-7 capitalize",
                  view === option && "bg-[var(--fm-admin-surface)] shadow-sm",
                )}
                onClick={() => changeView(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
      </div>
      {rangeIncomplete ? (
        <p role="alert" className="border-b border-[var(--fm-border)] px-4 py-2 text-sm">
          This range could not be fully loaded. Refresh to try again.
        </p>
      ) : null}
      {!loading && cycles.length === 0 ? (
        <p className="border-b border-[var(--fm-border)] px-4 py-2 text-sm text-[var(--fm-text-muted)]">
          No cycles in this range. Select an empty date to start one.
        </p>
      ) : null}
      <div className="fm-cycle-calendar min-h-[36rem] p-2 sm:p-3">
        <FullCalendar
          controller={controller}
          plugins={[pulseThemePlugin, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={false}
          timeZone={timezone}
          firstDay={1}
          height="auto"
          fixedWeekCount={false}
          dayMaxEvents={3}
          nowIndicator
          allDayText="Ordering"
          slotMinTime="04:00:00"
          slotMaxTime="21:00:00"
          scrollTime="05:00:00"
          eventTimeFormat={{ hour: "numeric", minute: "2-digit" }}
          events={events}
          datesSet={(info) => {
            setView(viewName(info.view.type));
            onRangeChange(info);
          }}
          dateClick={(info: DateClickInfo) => onEmptyDate(info.dateStr.slice(0, 10))}
          eventClick={(info: EventClickInfo) => {
            info.jsEvent.preventDefault();
            if (!info.event.extendedProps.draft)
              onSelectCycle(String(info.event.extendedProps.cycleId));
          }}
          eventClass={eventClass}
          eventContent={(info) => (
            <span className="flex min-w-0 items-center gap-1">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
              <span className="truncate">
                {info.event.extendedProps.draft ? "Unsaved preview · " : ""}
                {view === "month" && info.event.extendedProps.kind === "ordering"
                  ? info.event.title
                  : kindLabels[info.event.extendedProps.kind as CycleCalendarElementKind]}
              </span>
            </span>
          )}
          noEventsText="No cycles in this range"
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--fm-border)] px-4 py-3 text-xs text-[var(--fm-text-muted)]">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-6 rounded-full bg-[var(--fm-admin-accent)]" /> Ordering window
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full border-2 border-[var(--fm-admin-accent)]" />
          Fulfillment milestones
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-sm bg-[var(--fm-admin-accent-soft)] ring-1 ring-[var(--fm-admin-accent)]" />
          Customer delivery
        </span>
      </div>
    </section>
  );
}
