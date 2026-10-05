"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type {
  AdminCycleDestinations,
  AdminDeliveryCyclePage,
  DeliveryCycleDraft,
} from "@freshmarkets/contracts";
import { Calendar } from "@/components/admin/shadcn/calendar";
import { Button } from "@/components/admin/shadcn/button";
import { Checkbox } from "@/components/admin/shadcn/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/admin/shadcn/alert-dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/admin/shadcn/field";
import { Input } from "@/components/admin/shadcn/input";
import { Label } from "@/components/admin/shadcn/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/admin/shadcn/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/admin/shadcn/select";
import { CycleTimeline } from "./cycle-timeline";
import {
  addBusinessDays,
  businessFieldsToInstant,
  instantToBusinessFields,
  shiftInstantToDeliveryDate,
  suggestedCycleSchedule,
} from "./cycle-time";
import { validateCycleDraft, type CycleField } from "./cycle-validation";

const scheduleFields = [
  ["orderOpensAt", "Orders open", "orders-open"],
  ["cutoffAt", "Order cutoff", "cutoff"],
  ["procurementAt", "Procurement starts", "procurement"],
  ["preparationAt", "Preparation starts", "preparation"],
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
          className="w-full min-w-0 justify-start font-normal"
        >
          <CalendarDays aria-hidden data-icon="inline-start" />
          <span className="truncate">{displayDate(value)}</span>
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
  const fieldId = label.replaceAll(" ", "-").toLowerCase();
  const errorId = `${fieldId}-error`;
  return (
    <FieldSet className="min-w-0 gap-2 py-2">
      <FieldLegend variant="label">{label}</FieldLegend>
      <FieldGroup className="grid min-w-0 grid-cols-2 gap-2">
        <Field className="min-w-0">
          <DateButton
            label={label}
            value={fields.date}
            invalid={Boolean(error)}
            onChange={(date) => update({ date })}
          />
        </Field>
        <Field className="min-w-0">
          <FieldLabel htmlFor={`${fieldId}-time`} className="sr-only">
            {label} time
          </FieldLabel>
          <Input
            id={`${fieldId}-time`}
            aria-label={`${label} time`}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            type="time"
            className="min-w-0"
            value={fields.time}
            onChange={(event) => update({ time: event.target.value })}
          />
        </Field>
      </FieldGroup>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </FieldSet>
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
  if (!draft.orderOpensAt) Object.assign(next, suggestedCycleSchedule(nextDate, timezone));
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
    <p role="alert" className="text-xs text-destructive">
      {errors[field]}
    </p>
  ) : null;
}

export function CycleEditor({
  draft,
  mode,
  step,
  setStep,
  reviewed,
  setReviewed,
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
  mode: "new" | "edit" | "duplicate" | "reschedule";
  step: number;
  setStep: Dispatch<SetStateAction<number>>;
  reviewed: boolean;
  setReviewed: Dispatch<SetStateAction<boolean>>;
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
  const rescheduling = mode === "reschedule";
  const [confirming, setConfirming] = useState(false);
  const errors = useMemo(
    () => validateCycleDraft(draft, Date.now(), { requireFutureCutoff: !rescheduling }),
    [draft, rescheduling],
  );
  const delivery = draft.windows[0];
  const deliveryStart = instantToBusinessFields(delivery?.startsAt ?? "", timezone);
  const deliveryEnd = instantToBusinessFields(delivery?.endsAt ?? "", timezone);
  const deliveryRange = `${displayDate(deliveryStart.date)} · ${deliveryStart.time}–${
    deliveryEnd.date !== deliveryStart.date ? `${displayDate(deliveryEnd.date)} · ` : ""
  }${deliveryEnd.time}`;
  const setDeliveryBoundary = (field: "startsAt" | "endsAt", value: string) =>
    onChange({
      ...draft,
      windows: [
        {
          ...delivery,
          name: delivery?.name ?? "Scheduled delivery",
          startsAt: field === "startsAt" ? value : (delivery?.startsAt ?? ""),
          endsAt: field === "endsAt" ? value : (delivery?.endsAt ?? ""),
        },
      ],
    });
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
      const blocked =
        scheduleFields.some(([field]) => errors[field]) ||
        errors.deliveryStartsAt ||
        errors.deliveryEndsAt;
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
        if (rescheduling) {
          setConfirming(true);
          return;
        }
        onSave(draft);
      }}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <p className="text-xs font-semibold text-primary">Step {step} of 3</p>
          <h2 className="mt-1 text-xl font-semibold">
            {rescheduling
              ? "Edit schedule"
              : mode === "edit"
                ? "Edit cycle"
                : mode === "duplicate"
                  ? "Duplicate cycle"
                  : "New cycle"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Plan in {timezone}</p>
        </div>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          Discard
        </Button>
      </header>
      <fieldset disabled={pending} className="contents">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-6 grid grid-cols-3 gap-2" aria-label="Editor progress">
            {["Delivery", "Schedule", "Review"].map((label, index) => (
              <div key={label} className="space-y-1">
                <div
                  className={`h-1 rounded-full ${index + 1 <= step ? "bg-primary" : "bg-border"}`}
                />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold">Delivery and locations</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start with the promise customers will see, then build the operating plan
                  backwards.
                </p>
              </div>
              {markets.length > 1 ? (
                <div className="space-y-1.5">
                  <Label>Business</Label>
                  <Select
                    disabled={rescheduling}
                    value={draft.marketId}
                    onValueChange={(marketId) =>
                      onChange({ ...draft, marketId, participation: [] })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose business" />
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
                <p className="text-xs text-muted-foreground">
                  {mode === "duplicate"
                    ? "Changing this date shifts the copied schedule by the same number of days."
                    : "Changing this date keeps the exact schedule milestones you have already set."}
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
                <p className="text-xs text-muted-foreground">
                  All selected locations follow this cycle’s ordering, procurement, preparation and
                  customer delivery schedule. Choose rider pickup when each order is packed.
                </p>
                {destinationError ? (
                  <p role="alert" className="text-sm text-destructive">
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
                        className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 py-2"
                      >
                        <Checkbox
                          disabled={rescheduling}
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
                  <p className="text-sm text-muted-foreground">
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
                <p className="mt-1 text-sm text-muted-foreground">
                  Milestones are exact points in time. Adjusting one does not silently move another.
                </p>
              </div>
              <div className="divide-y divide-border">
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
              <FieldSet>
                <FieldLegend>Customer delivery</FieldLegend>
                <p className="text-sm text-muted-foreground">
                  When customers should receive their orders. Set the start and end independently.
                </p>
                <DateTimeRow
                  label="Customer delivery starts"
                  value={delivery?.startsAt ?? ""}
                  timezone={timezone}
                  error={reviewed ? errors.deliveryStartsAt : undefined}
                  onChange={(value) => setDeliveryBoundary("startsAt", value)}
                />
                <DateTimeRow
                  label="Customer delivery ends"
                  value={delivery?.endsAt ?? ""}
                  timezone={timezone}
                  error={reviewed ? errors.deliveryEndsAt : undefined}
                  onChange={(value) => setDeliveryBoundary("endsAt", value)}
                />
              </FieldSet>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold">Review and save</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {rescheduling
                    ? "Apply the revised ordering and delivery schedule. Existing paid-order promises and charges are preserved; delivery operations use this cycle's updated window. Existing courier bookings require their normal change or cancellation flow. Extending ordering reopens an unpurchased cycle."
                    : "Saving keeps this cycle in Draft. Activate it separately after reviewing the saved plan."}
                </p>
              </div>
              <section>
                <h4 className="text-xs font-semibold text-muted-foreground">Customer delivery</h4>
                <p className="mt-2 font-semibold">{deliveryRange}</p>
              </section>
              <section>
                <h4 className="text-xs font-semibold text-muted-foreground">Schedule</h4>
                <CycleTimeline
                  timezone={timezone}
                  items={scheduleFields.map(([field, label, kind]) => ({
                    label,
                    value: draft[field],
                    kind,
                  }))}
                />
              </section>
              <section>
                <h4 className="text-xs font-semibold text-muted-foreground">Locations</h4>
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
              <FieldGroup>
                <Field data-invalid={Boolean(errors.reason)}>
                  <FieldLabel htmlFor="cycle-reason">
                    {rescheduling ? "Reason for schedule change" : "Planning note"}
                  </FieldLabel>
                  <Input
                    id="cycle-reason"
                    maxLength={500}
                    value={draft.reason}
                    aria-invalid={reviewed && Boolean(errors.reason)}
                    onChange={(event) => onChange({ ...draft, reason: event.target.value })}
                  />
                  <FieldError field="reason" errors={errors} />
                </Field>
              </FieldGroup>
            </div>
          ) : null}
        </div>
      </fieldset>
      <footer className="flex items-center justify-between gap-2 border-t border-border p-4">
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
            {pending ? "Saving…" : rescheduling ? "Save schedule" : "Save draft"}
          </Button>
        )}
      </footer>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply the revised cycle schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              Ordering and delivery operations will use the revised dates and window. Original
              paid-order promises and charges stay unchanged. Existing courier bookings must be
              changed or canceled through their normal controls.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => onSave(draft)} disabled={pending}>
              Apply schedule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
