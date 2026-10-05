import type { DeliveryCycleDraft } from "@freshmarkets/contracts";

/** Scheduling policy belongs to Core; quantities and physical stock are unrelated. */
export function validateDeliveryCycleSchedule(
  draft: Pick<
    DeliveryCycleDraft,
    "orderOpensAt" | "cutoffAt" | "procurementAt" | "preparationAt" | "windows" | "participation"
  >,
  now: number,
  options: { requireFutureCutoff?: boolean } = {},
): string | null {
  const opens = Date.parse(draft.orderOpensAt);
  const cutoff = Date.parse(draft.cutoffAt);
  const procurement = Date.parse(draft.procurementAt);
  const preparation = Date.parse(draft.preparationAt);
  if (![opens, cutoff, procurement, preparation].every(Number.isSafeInteger))
    return "Schedule times must be valid instants";
  if (
    !(
      opens < cutoff &&
      (options.requireFutureCutoff === false || cutoff > now) &&
      cutoff <= procurement &&
      procurement <= preparation
    )
  )
    return "Order opening, cutoff, procurement and preparation must be in order";
  if (draft.windows.length !== 1) return "A Scheduled cycle must have one customer delivery range";
  if (
    draft.windows.some((window) => {
      const starts = Date.parse(window.startsAt),
        ends = Date.parse(window.endsAt);
      return (
        !Number.isSafeInteger(starts) ||
        !Number.isSafeInteger(ends) ||
        starts < preparation ||
        ends <= starts
      );
    })
  )
    return "The customer delivery range must follow preparation and end after it starts";
  if (
    draft.participation.length === 0 ||
    new Set(draft.participation.map((item) => JSON.stringify([item.zoneId, item.locationId])))
      .size !== draft.participation.length
  )
    return "Select distinct participating zones and locations";
  return null;
}
