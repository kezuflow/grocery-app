export const ASSIGNABLE_DELIVERY_STATES = ["UNASSIGNED", "RETRY_SCHEDULED"] as const;
export const REUSABLE_DELIVERY_BATCH_STATES = ["COMPLETED", "CANCELED"] as const;

export function isAssignableDeliveryState(
  value: string,
): value is (typeof ASSIGNABLE_DELIVERY_STATES)[number] {
  return (ASSIGNABLE_DELIVERY_STATES as readonly string[]).includes(value);
}

export function isReusableDeliveryBatchState(value: string): boolean {
  return (REUSABLE_DELIVERY_BATCH_STATES as readonly string[]).includes(value);
}

export function isBoundedCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
