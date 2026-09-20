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
  orderOpeningDate = addBusinessDays(deliveryDate, -5),
) {
  return {
    orderOpensAt: businessFieldsToInstant({ date: orderOpeningDate, time: "00:00" }, timezone),
    cutoffAt: businessFieldsToInstant(
      { date: addBusinessDays(deliveryDate, -1), time: "23:59" },
      timezone,
    ),
    procurementAt: businessFieldsToInstant({ date: deliveryDate, time: "00:00" }, timezone),
    preparationAt: businessFieldsToInstant({ date: deliveryDate, time: "02:00" }, timezone),
    pickupAt: businessFieldsToInstant({ date: deliveryDate, time: "04:00" }, timezone),
  };
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
