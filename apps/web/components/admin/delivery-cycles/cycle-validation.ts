import type { DeliveryCycleDraft } from "@freshmarkets/contracts";

export type CycleField =
  | "name"
  | "marketId"
  | "participation"
  | "orderOpensAt"
  | "cutoffAt"
  | "procurementAt"
  | "preparationAt"
  | "pickupAt"
  | "deliveryStartsAt"
  | "deliveryEndsAt"
  | "reason";

export function validateCycleDraft(draft: DeliveryCycleDraft, now = Date.now()) {
  const errors: Partial<Record<CycleField, string>> = {};
  const delivery = draft.windows[0];
  if (!draft.name.trim()) errors.name = "Give this cycle a clear name.";
  if (!draft.marketId) errors.marketId = "Choose a market.";
  if (!draft.participation.length)
    errors.participation = "Select at least one fulfillment location.";
  if (!draft.reason.trim()) errors.reason = "Add the required planning note.";
  const required: Array<[CycleField, string]> = [
    ["orderOpensAt", draft.orderOpensAt],
    ["cutoffAt", draft.cutoffAt],
    ["procurementAt", draft.procurementAt],
    ["preparationAt", draft.preparationAt],
    ["pickupAt", draft.pickupAt],
    ["deliveryStartsAt", delivery?.startsAt ?? ""],
    ["deliveryEndsAt", delivery?.endsAt ?? ""],
  ];
  for (const [field, value] of required) if (!value) errors[field] = "Choose a date and time.";
  if (
    Object.keys(errors).some((field) => required.some(([requiredField]) => requiredField === field))
  )
    return errors;
  const opens = Date.parse(draft.orderOpensAt);
  const cutoff = Date.parse(draft.cutoffAt);
  const procurement = Date.parse(draft.procurementAt);
  const preparation = Date.parse(draft.preparationAt);
  const pickup = Date.parse(draft.pickupAt);
  const deliveryStart = Date.parse(delivery!.startsAt);
  const deliveryEnd = Date.parse(delivery!.endsAt);
  if (opens >= cutoff) errors.cutoffAt = "Order cutoff must be after orders open.";
  if (cutoff <= now) errors.cutoffAt = "This cutoff has already passed. Choose a future cutoff.";
  if (procurement < cutoff)
    errors.procurementAt = "Procurement cannot start before the order cutoff.";
  if (preparation < procurement)
    errors.preparationAt = "Preparation cannot start before procurement.";
  if (pickup < preparation) errors.pickupAt = "Planned pickup cannot be before preparation starts.";
  if (deliveryStart < pickup)
    errors.deliveryStartsAt = "Delivery must start at or after the planned pickup.";
  if (deliveryEnd <= deliveryStart) errors.deliveryEndsAt = "Delivery must end after it starts.";
  return errors;
}
