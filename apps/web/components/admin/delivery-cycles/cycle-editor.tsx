"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import type {
  AdminCycleDestinations,
  AdminDeliveryCyclePage,
  DeliveryCycleDraft,
} from "@freshmarkets/contracts";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CycleTimeline } from "./cycle-timeline";
import {
  addBusinessDays,
  businessFieldsToInstant,
  instantToBusinessFields,
  shiftInstantToDeliveryDate,
} from "./cycle-time";
import { validateCycleDraft, type CycleField } from "./cycle-validation";

const scheduleFields = [
  ["orderOpensAt", "Orders open"],
  ["cutoffAt", "Order cutoff"],
  ["procurementAt", "Procurement starts"],
  ["preparationAt", "Preparation starts"],
  ["pickupAt", "Planned pickup"],
] as const;

function displayDate(date: string) {
  if (!date) return "Choose date";
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function dateValue(date: Date) {
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

function DateButton({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  onChange(value: string): void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={`${label} date`}
          aria-invalid={invalid}
          className="w-full justify-start font-normal"
        >
          <CalendarDays aria-hidden className="size-4 text-[var(--fm-text-muted)]" />
          {displayDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value ? new Date(`${value}T12:00:00`) : undefined}
          onSelect={(date) => date && onChange(dateValue(date))}
        />
      </PopoverContent>
    </Popover>
  );
}

function DateTimeRow({
  label,
  value,
  timezone,
  error,
  onChange,
}: {
  label: string;
  value: string;
  timezone: string;
  error?: string;
  onChange(value: string): void;
}) {
  const fields = instantToBusinessFields(value, timezone);
  const update = (next: Partial<typeof fields>) =>
    onChange(businessFieldsToInstant({ ...fields, ...next }, timezone));
  const errorId = `${label.replaceAll(" ", "-").toLowerCase()}-error`;
  return (
    <div className="grid gap-2 py-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(10rem,1.25fr)_7.5rem] sm:items-start">
      <Label className="pt-2 text-sm">{label}</Label>
      <DateButton
        label={label}
        value={fields.date}
        invalid={Boolean(error)}
        onChange={(date) => update({ date })}
      />
      <Input
        aria-label={`${label} time`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        type="time"
        value={fields.time}
        onChange={(event) => update({ time: event.target.value })}
      />
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-[var(--fm-destructive)] sm:col-start-2 sm:col-span-2"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function suggestedName(date: string) {
  if (!date) return "";
  const value = new Date(`${date}T12:00:00`);
  return `${new Intl.DateTimeFormat("en-PH", { weekday: "long" }).format(value)} delivery · ${new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short" }).format(value)}`;
}

function applyDeliveryDate(
  draft: DeliveryCycleDraft,
  nextDate: string,
  timezone: string,
  duplicate: boolean,
) {
  const currentWindow = draft.windows[0];
  const currentStart = instantToBusinessFields(currentWindow?.startsAt ?? "", timezone);
  const currentEnd = instantToBusinessFields(currentWindow?.endsAt ?? "", timezone);
  const sourceDate = currentStart.date;
  const deliveryStart = businessFieldsToInstant(
    { date: nextDate, time: currentStart.time || "09:00" },
    timezone,
  );
  const nextEndDate =
    (currentEnd.date && currentStart.date && currentEnd.date > currentStart.date) ||
    (currentEnd.time && currentStart.time && currentEnd.time <= currentStart.time)
      ? addBusinessDays(nextDate, 1)
      : nextDate;
  const deliveryEnd = businessFieldsToInstant(
    { date: nextEndDate, time: currentEnd.time || "12:00" },
    timezone,
  );
  const next: DeliveryCycleDraft = {
    ...draft,
    name: draft.name || suggestedName(nextDate),
    windows: [{ name: "Scheduled delivery", startsAt: deliveryStart, endsAt: deliveryEnd }],
  };
  if (duplicate && sourceDate) {
    for (const field of scheduleFields.map(([field]) => field))
      next[field] = shiftInstantToDeliveryDate(draft[field], sourceDate, nextDate, timezone);
    return next;
  }
  if (!draft.orderOpensAt) {
    next.orderOpensAt = businessFieldsToInstant(
      { date: addBusinessDays(nextDate, -5), time: "08:00" },
      timezone,
    );
    next.cutoffAt = businessFieldsToInstant(
      { date: addBusinessDays(nextDate, -1), time: "17:00" },
      timezone,
    );
    next.procurementAt = businessFieldsToInstant({ date: nextDate, time: "05:00" }, timezone);
    next.preparationAt = businessFieldsToInstant({ date: nextDate, time: "06:00" }, timezone);
    next.pickupAt = businessFieldsToInstant({ date: nextDate, time: "08:30" }, timezone);
  }
  return next;
}

function FieldError({
  field,
  errors,
}: {
  field: CycleField;
  errors: ReturnType<typeof validateCycleDraft>;
}) {
  return errors[field] ? (
    <p role="alert" className="text-xs text-[var(--fm-destructive)]">
      {errors[field]}
    </p>
  ) : null;
}

export function CycleEditor({
  draft,
  mode,
  markets,
  timezone,
  destinations,
  destinationsLoading,
  destinationError,
  pending,
  submitting,
  retryAvailable,
  onChange,
  onCancel,
  onSave,
  onRetry,
  onLoadMoreDestinations,
}: {
  draft: DeliveryCycleDraft;
  mode: "new" | "edit" | "duplicate";
  markets: AdminDeliveryCyclePage["markets"];
  timezone: string;
  destinations: AdminCycleDestinations;
  destinationsLoading: boolean;
  destinationError: string | null;
  pending: boolean;
  submitting: boolean;
  retryAvailable: boolean;
  onChange(draft: DeliveryCycleDraft): void;
  onCancel(): void;
  onSave(draft: DeliveryCycleDraft): void;
  onRetry(): void;
  onLoadMoreDestinations(): void;
}) {
  const [step, setStep] = useState(1);
  const [reviewed, setReviewed] = useState(false);
  const errors = useMemo(() => validateCycleDraft(draft), [draft]);
  const delivery = draft.windows[0];
  const deliveryStart = instantToBusinessFields(delivery?.startsAt ?? "", timezone);
  const deliveryEnd = instantToBusinessFields(delivery?.endsAt ?? "", timezone);
  const setDeliveryTime = (field: "startsAt" | "endsAt", time: string) => {
    const startTime = field === "startsAt" ? time : deliveryStart.time;
    const endTime = field === "endsAt" ? time : deliveryEnd.time;
    const endDate =
      deliveryStart.date && startTime && endTime && endTime <= startTime
        ? addBusinessDays(deliveryStart.date, 1)
        : deliveryStart.date;
    onChange({
      ...draft,
      windows: [
        {
          name: "Scheduled delivery",
          startsAt: businessFieldsToInstant(
            { date: deliveryStart.date, time: startTime },
            timezone,
          ),
          endsAt: businessFieldsToInstant({ date: endDate, time: endTime }, timezone),
        },
      ],
    });
  };
  const nextStep = () => {
    setReviewed(true);
    if (step === 1) {
      const blocked = [
        "name",
        "marketId",
        "participation",
        "deliveryStartsAt",
        "deliveryEndsAt",
      ].some((field) => errors[field as CycleField]);
      if (blocked) return;
    }
    if (step === 2) {
      const blocked = scheduleFields.some(([field]) => errors[field]);
      if (blocked) return;
    }
    setStep((current) => Math.min(3, current + 1));
  };
  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        setReviewed(true);
        if (Object.keys(errors).length) return;
        onSave(draft);
      }}
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--fm-border)] p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-admin-accent-strong)]">
            Step {step} of 3
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {mode === "edit"
              ? "Edit cycle"
              : mode === "duplicate"
                ? "Duplicate cycle"
                : "New cycle"}
          </h2>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">Plan in {timezone}</p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Close cycle editor"
          disabled={pending}
          onClick={onCancel}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </header>
      <fieldset disabled={pending} className="contents">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-6 grid grid-cols-3 gap-2" aria-label="Editor progress">
            {["Delivery", "Schedule", "Review"].map((label, index) => (
              <div key={label} className="space-y-1">
                <div
                  className={`h-1 rounded-full ${index + 1 <= step ? "bg-[var(--fm-admin-accent)]" : "bg-[var(--fm-border)]"}`}
                />
                <span className="text-xs text-[var(--fm-text-muted)]">{label}</span>
              </div>
            ))}
          </div>
          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold">Delivery and locations</h3>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Start with the promise customers will see, then build the operating plan
                  backwards.
                </p>
              </div>
              {markets.length > 1 ? (
                <div className="space-y-1.5">
                  <Label>Market</Label>
                  <Select
                    value={draft.marketId}
                    onValueChange={(marketId) =>
                      onChange({ ...draft, marketId, participation: [] })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose market" />
                    </SelectTrigger>
                    <SelectContent>
                      {markets.map((market) => (
                        <SelectItem key={market.marketId} value={market.marketId}>
                          {market.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {reviewed ? <FieldError field="marketId" errors={errors} /> : null}
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label>Customer delivery date</Label>
                <DateButton
                  label="Customer delivery"
                  value={deliveryStart.date}
                  invalid={reviewed && Boolean(errors.deliveryStartsAt)}
                  onChange={(date) =>
                    onChange(applyDeliveryDate(draft, date, timezone, mode === "duplicate"))
                  }
                />
                <p className="text-xs text-[var(--fm-text-muted)]">
                  Clicking a calendar date prefills this date only.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="delivery-start-time">Arrival starts</Label>
                  <Input
                    id="delivery-start-time"
                    type="time"
                    value={deliveryStart.time}
                    aria-invalid={reviewed && Boolean(errors.deliveryStartsAt)}
                    onChange={(event) => setDeliveryTime("startsAt", event.target.value)}
                  />
                  {reviewed ? <FieldError field="deliveryStartsAt" errors={errors} /> : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delivery-end-time">Arrival ends</Label>
                  <Input
                    id="delivery-end-time"
                    type="time"
                    value={deliveryEnd.time}
                    aria-invalid={reviewed && Boolean(errors.deliveryEndsAt)}
                    onChange={(event) => setDeliveryTime("endsAt", event.target.value)}
                  />
                  {reviewed ? <FieldError field="deliveryEndsAt" errors={errors} /> : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cycle-name">Cycle name</Label>
                <Input
                  id="cycle-name"
                  maxLength={120}
                  value={draft.name}
                  aria-invalid={reviewed && Boolean(errors.name)}
                  onChange={(event) => onChange({ ...draft, name: event.target.value })}
                />
                {reviewed ? <FieldError field="name" errors={errors} /> : null}
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Fulfillment locations</legend>
                <p className="text-xs text-[var(--fm-text-muted)]">
                  All selected locations follow this cycle’s ordering, procurement, preparation, and
                  pickup schedule.
                </p>
                {destinationError ? (
                  <p role="alert" className="text-sm text-[var(--fm-destructive)]">
                    {destinationError}
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  {destinations.items.map((item) => {
                    const checked = draft.participation.some(
                      (selected) =>
                        selected.zoneId === item.zoneId && selected.locationId === item.locationId,
                    );
                    return (
                      <Label
                        key={`${item.zoneId}:${item.locationId}`}
                        className="flex min-h-10 items-center gap-2 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-3 py-2"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) =>
                            onChange({
                              ...draft,
                              participation: next
                                ? [
                                    ...draft.participation,
                                    { zoneId: item.zoneId, locationId: item.locationId },
                                  ]
                                : draft.participation.filter(
                                    (selected) =>
                                      selected.zoneId !== item.zoneId ||
                                      selected.locationId !== item.locationId,
                                  ),
                            })
                          }
                        />
                        {item.locationName}
                      </Label>
                    );
                  })}
                </div>
                {!destinations.items.length && !destinationError ? (
                  <p className="text-sm text-[var(--fm-text-muted)]">
                    {destinationsLoading
                      ? "Loading eligible locations…"
                      : "No eligible locations are configured."}
                  </p>
                ) : null}
                {destinationError || destinations.nextCursor ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onLoadMoreDestinations}
                  >
                    {destinationError ? "Retry locations" : "More locations"}
                  </Button>
                ) : null}
                {reviewed ? <FieldError field="participation" errors={errors} /> : null}
              </fieldset>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">Build the schedule</h3>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Milestones are exact points in time. Adjusting one does not silently move another.
                </p>
              </div>
              <div className="divide-y divide-[var(--fm-border)]">
                {scheduleFields.map(([field, label]) => (
                  <DateTimeRow
                    key={field}
                    label={label}
                    value={draft[field]}
                    timezone={timezone}
                    error={reviewed ? errors[field] : undefined}
                    onChange={(value) => onChange({ ...draft, [field]: value })}
                  />
                ))}
              </div>
              <div className="rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-muted)] p-3 text-sm">
                <span className="text-[var(--fm-text-muted)]">Customer delivery</span>
                <br />
                {delivery?.startsAt && delivery.endsAt
                  ? `${displayDate(deliveryStart.date)} · ${deliveryStart.time}–${deliveryEnd.time}`
                  : "Choose the delivery date and range in Step 1."}
              </div>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold">Review and save</h3>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Saving keeps this cycle in Draft. Activate it separately after reviewing the saved
                  plan.
                </p>
              </div>
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                  Customer delivery
                </h4>
                <p className="mt-2 font-semibold">
                  {displayDate(deliveryStart.date)} · {deliveryStart.time}–{deliveryEnd.time}
                </p>
              </section>
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                  Schedule
                </h4>
                <CycleTimeline
                  timezone={timezone}
                  items={scheduleFields.map(([field, label]) => ({ label, value: draft[field] }))}
                />
              </section>
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                  Locations
                </h4>
                <p className="mt-2 text-sm">
                  {destinations.items
                    .filter((item) =>
                      draft.participation.some(
                        (selected) =>
                          selected.zoneId === item.zoneId &&
                          selected.locationId === item.locationId,
                      ),
                    )
                    .map((item) => item.locationName)
                    .join(", ")}
                </p>
              </section>
              <div className="space-y-1.5">
                <Label htmlFor="cycle-reason">Planning note</Label>
                <Input
                  id="cycle-reason"
                  maxLength={500}
                  value={draft.reason}
                  aria-invalid={reviewed && Boolean(errors.reason)}
                  onChange={(event) => onChange({ ...draft, reason: event.target.value })}
                />
                <FieldError field="reason" errors={errors} />
              </div>
            </div>
          ) : null}
        </div>
      </fieldset>
      <footer className="flex items-center justify-between gap-2 border-t border-[var(--fm-border)] p-4">
        <Button
          type="button"
          variant="ghost"
          disabled={pending || step === 1}
          onClick={() => setStep((current) => Math.max(1, current - 1))}
        >
          <ChevronLeft aria-hidden className="size-4" /> Back
        </Button>
        {retryAvailable ? (
          <Button type="button" disabled={submitting} onClick={onRetry}>
            {submitting ? "Retrying…" : "Retry unconfirmed request"}
          </Button>
        ) : step < 3 ? (
          <Button type="button" disabled={pending} onClick={nextStep}>
            Continue <ChevronRight aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save draft"}
          </Button>
        )}
      </footer>
    </form>
  );
}
