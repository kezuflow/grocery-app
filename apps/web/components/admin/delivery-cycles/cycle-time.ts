import { Temporal } from "temporal-polyfill";

export type BusinessDateTime = { date: string; time: string };

export function instantToBusinessFields(value: string, timezone: string): BusinessDateTime {
  if (!value) return { date: "", time: "" };
  const zoned = Temporal.Instant.from(value).toZonedDateTimeISO(timezone);
  return {
    date: zoned.toPlainDate().toString(),
    time: zoned.toPlainTime().toString({ smallestUnit: "minute" }),
  };
}

export function businessFieldsToInstant(value: BusinessDateTime, timezone: string): string {
  if (!value.date || !value.time) return "";
  return Temporal.PlainDateTime.from(`${value.date}T${value.time}`)
    .toZonedDateTime(timezone)
    .toInstant()
    .toString();
}

export function instantToBusinessDate(value: string, timezone: string): string {
  return instantToBusinessFields(value, timezone).date;
}

export function addBusinessDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function suggestedCycleSchedule(
  deliveryDate: string,
  timezone: string,
  orderOpeningDate = addBusinessDays(deliveryDate, -8),
) {
  const cutoffDate = addBusinessDays(deliveryDate, -1);
  const cutoffAt = businessFieldsToInstant({ date: cutoffDate, time: "00:00" }, timezone);
  return {
    orderOpensAt: businessFieldsToInstant({ date: orderOpeningDate, time: "00:00" }, timezone),
    cutoffAt,
    procurementAt: cutoffAt,
    preparationAt: cutoffAt,
  };
}

export function suggestedDeliveryWindow(deliveryDate: string, timezone: string) {
  return {
    name: "Scheduled delivery",
    startsAt: businessFieldsToInstant({ date: deliveryDate, time: "00:00" }, timezone),
    endsAt: businessFieldsToInstant(
      { date: addBusinessDays(deliveryDate, 1), time: "23:59" },
      timezone,
    ),
  };
}

export function deliveryDateForPlanningRange(startDate: string, endDateExclusive: string): string {
  // FullCalendar ends selections after the last selected date. Multi-day drags
  // end on the cutoff date; a single-day selection still chooses delivery day.
  return endDateExclusive > addBusinessDays(startDate, 1) ? endDateExclusive : startDate;
}

export function shiftInstantToDeliveryDate(
  value: string,
  sourceDeliveryDate: string,
  targetDeliveryDate: string,
  timezone: string,
): string {
  if (!value || !sourceDeliveryDate || !targetDeliveryDate) return value;
  const fields = instantToBusinessFields(value, timezone);
  const dayOffset = Temporal.PlainDate.from(sourceDeliveryDate).until(
    Temporal.PlainDate.from(fields.date),
    { largestUnit: "day" },
  ).days;
  return businessFieldsToInstant(
    { date: addBusinessDays(targetDeliveryDate, dayOffset), time: fields.time },
    timezone,
  );
}
