"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import FullCalendar, {
  useCalendarController,
  type DateClickInfo,
  type DateSelectInfo,
  type DatesSetInfo,
  type EventClickInfo,
  type EventDisplayInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import type { AdminDeliveryCycleView, DeliveryCycleDraft } from "@freshmarkets/contracts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cyclesToCalendarEvents } from "./cycle-calendar-adapter";

export type CycleCalendarView = "month" | "week" | "agenda";

function viewName(type: string): CycleCalendarView {
  if (type === "timeGridWeek") return "week";
  if (type === "listMonth") return "agenda";
  return "month";
}

export function CycleCalendar({
  cycles,
  timezone,
  selectedCycleId,
  draft,
  loading,
  error,
  rangeIncomplete,
  canCreate,
  interactionLocked,
  filters,
  onRangeChange,
  onSelectCycle,
  onEmptyDate,
  onDateRange,
  onRefresh,
}: {
  cycles: readonly AdminDeliveryCycleView[];
  timezone: string;
  selectedCycleId: string | null;
  draft: DeliveryCycleDraft | null;
  loading: boolean;
  error: string | null;
  rangeIncomplete: boolean;
  canCreate: boolean;
  interactionLocked: boolean;
  filters?: ReactNode;
  onRangeChange(info: DatesSetInfo): void;
  onSelectCycle(cycleId: string): void;
  onEmptyDate(date: string): void;
  onDateRange(startDate: string, endDate: string): void;
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
    const useMobileAgenda = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) controller.changeView("listMonth");
    };
    useMobileAgenda(query);
    query.addEventListener("change", useMobileAgenda);
    return () => query.removeEventListener("change", useMobileAgenda);
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
      `fm-cycle-event-${String(info.event.extendedProps.kind)}`,
    );
  return (
    <section
      aria-label="Scheduled cycle calendar"
      className="min-w-0 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]"
    >
      <div className="flex flex-wrap items-end gap-2 border-b border-[var(--fm-border)] p-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={interactionLocked}
            onClick={() => controller.today()}
          >
            Today
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Previous calendar period"
            disabled={interactionLocked}
            onClick={() => controller.prev()}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <h2 aria-live="polite" className="min-w-32 px-2 text-base font-semibold">
            {controller.view?.title ?? "Schedule"}
          </h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Next calendar period"
            disabled={interactionLocked}
            onClick={() => controller.next()}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
        {filters ? (
          <div className="flex flex-1 flex-wrap items-end gap-2 lg:justify-end">{filters}</div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1 lg:ml-auto">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Refresh visible calendar range"
            disabled={loading || interactionLocked}
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
                disabled={interactionLocked}
                className={cn(
                  "min-h-9 capitalize",
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
      {error ? (
        <p
          role="alert"
          className="border-b border-[var(--fm-border)] px-4 py-2 text-sm text-[var(--fm-destructive)]"
        >
          Cycles could not be loaded: {error} Use Refresh to try again.
        </p>
      ) : null}
      {!loading && !error && cycles.length === 0 ? (
        <p className="border-b border-[var(--fm-border)] px-4 py-2 text-sm text-[var(--fm-text-muted)]">
          No cycles in this range. Select an empty date to start one.
        </p>
      ) : null}
      <div
        className={cn(
          "fm-cycle-calendar p-2 sm:p-3",
          canCreate && view === "month" && "fm-cycle-calendar-selectable",
        )}
      >
        <p className="mb-2 px-1 text-xs text-[var(--fm-text-muted)]">
          {view === "month" && canCreate
            ? "Drag from the order-opening date to the customer-delivery date, or select one day."
            : "Select a cycle to inspect its complete schedule."}
        </p>
        <FullCalendar
          controller={controller}
          plugins={[
            classicThemePlugin,
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
          ]}
          initialView="dayGridMonth"
          headerToolbar={false}
          timeZone={timezone}
          firstDay={1}
          height={view === "week" ? 620 : 500}
          fixedWeekCount={false}
          dayMaxEvents={3}
          nowIndicator
          allDayText="Ordering"
          slotMinTime="04:00:00"
          slotMaxTime="21:00:00"
          scrollTime="05:00:00"
          eventTimeFormat={{ hour: "numeric", minute: "2-digit" }}
          events={events}
          selectable={canCreate && view === "month" && !loading && !interactionLocked}
          selectMirror
          selectMinDistance={8}
          selectLongPressDelay={350}
          datesSet={(info) => {
            setView(viewName(info.view.type));
            onRangeChange(info);
          }}
          dateClick={(info: DateClickInfo) => {
            if (!interactionLocked) onEmptyDate(info.dateStr.slice(0, 10));
          }}
          select={(info: DateSelectInfo) => {
            if (!info.allDay || interactionLocked) return;
            onDateRange(info.startStr.slice(0, 10), info.endStr.slice(0, 10));
          }}
          eventClick={(info: EventClickInfo) => {
            info.jsEvent.preventDefault();
            if (!interactionLocked && !info.event.extendedProps.draft)
              onSelectCycle(String(info.event.extendedProps.cycleId));
          }}
          eventClass={eventClass}
          noEventsText={error ? "Cycles unavailable" : "No cycles in this range"}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--fm-border)] px-4 py-3 text-xs text-[var(--fm-text-muted)]">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--fm-cycle-ordering)]" /> Ordering
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--fm-cycle-procurement)]" /> Procurement
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--fm-cycle-preparation)]" /> Preparation
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--fm-cycle-pickup)]" /> Pickup
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--fm-cycle-delivery)]" /> Delivery
        </span>
      </div>
    </section>
  );
}
