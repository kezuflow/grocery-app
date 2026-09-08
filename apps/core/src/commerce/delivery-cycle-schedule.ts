import type { DeliveryCycleDraft } from "@freshmarkets/contracts";

/** Scheduling policy belongs to Core; quantities and physical stock are unrelated. */
export function validateDeliveryCycleSchedule(
  draft: Pick<
    DeliveryCycleDraft,
    | "orderOpensAt"
    | "cutoffAt"
    | "procurementAt"
    | "preparationAt"
    | "pickupAt"
    | "windows"
    | "participation"
  >,
  now: number,
): string | null {
  const opens = Date.parse(draft.orderOpensAt);
  const cutoff = Date.parse(draft.cutoffAt);
  const procurement = Date.parse(draft.procurementAt);
  const preparation = Date.parse(draft.preparationAt);
  const pickup = Date.parse(draft.pickupAt);
  if (![opens, cutoff, procurement, preparation, pickup].every(Number.isSafeInteger))
    return "Schedule times must be valid instants";
  if (
    !(
      opens < cutoff &&
      cutoff > now &&
      cutoff <= procurement &&
      procurement <= preparation &&
      preparation <= pickup
    )
  )
    return "Order opening, future cutoff, procurement, preparation and pickup must be in order";
  if (
    draft.windows.length === 0 ||
    draft.windows.some((window) => {
      const starts = Date.parse(window.startsAt),
        ends = Date.parse(window.endsAt);
      return (
        !Number.isSafeInteger(starts) ||
        !Number.isSafeInteger(ends) ||
        starts < pickup ||
        ends <= starts
      );
    })
  )
    return "Each delivery window must follow pickup and end after it starts";
  if (new Set(draft.windows.map((window) => window.name)).size !== draft.windows.length)
    return "Delivery window names must be distinct";
  if (
    draft.participation.length === 0 ||
    new Set(draft.participation.map((item) => JSON.stringify([item.zoneId, item.locationId])))
      .size !== draft.participation.length
  )
    return "Select distinct participating zones and locations";
  return null;
}
