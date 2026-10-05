/** Order-level eligibility shared by preparation commands and their action projection. */
export function isOrderEligibleForPreparation(status: string): boolean {
  return [
    "COMMITTED",
    "FULFILLMENT_PENDING",
    "FULFILLMENT_READY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
  ].includes(status);
}
