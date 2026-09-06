export type CanonicalBaseUnitCode = "GRAM" | "MILLILITER" | "PIECE";

export type DeliveryPackageKind = "BAG" | "BOX";

export const BOX_MINIMUM_WEIGHT_GRAMS = 10_000;

function positiveSafeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

/**
 * Resolve the physical shipping weight for one order line. A gram-based SKU
 * already has an exact line-total base quantity. Count and volume SKUs need a
 * catalog estimate for one sellable SKU unit; pieces or milliliters are never
 * treated as grams.
 */
export function resolveLineShippingWeightGrams(
  input: Readonly<{
    baseUnitCode: CanonicalBaseUnitCode;
    quantity: number;
    baseQuantity: number;
    estimatedShippingWeightGrams: number | null;
  }>,
): number | null {
  if (!positiveSafeInteger(input.quantity) || !positiveSafeInteger(input.baseQuantity)) return null;
  if (input.baseUnitCode === "GRAM") return input.baseQuantity;
  if (!positiveSafeInteger(input.estimatedShippingWeightGrams)) return null;
  const total = input.quantity * input.estimatedShippingWeightGrams;
  return positiveSafeInteger(total) ? total : null;
}

export function totalShippingWeightGrams(lineWeights: readonly (number | null)[]): number | null {
  let total = 0;
  for (const weight of lineWeights) {
    if (!positiveSafeInteger(weight)) return null;
    total += weight;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total > 0 ? total : null;
}

/** Exactly 10 kg starts a box; anything lighter is one bag. */
export function deliveryPackageKind(totalWeightGrams: number): DeliveryPackageKind | null {
  if (!positiveSafeInteger(totalWeightGrams)) return null;
  return totalWeightGrams >= BOX_MINIMUM_WEIGHT_GRAMS ? "BOX" : "BAG";
}

export function deliveryPackageForLineWeights(
  lineWeights: readonly (number | null)[],
): Readonly<{ kind: DeliveryPackageKind; quantity: 1; weightGrams: number }> | null {
  const weightGrams = totalShippingWeightGrams(lineWeights);
  if (weightGrams === null) return null;
  const kind = deliveryPackageKind(weightGrams);
  return kind ? { kind, quantity: 1, weightGrams } : null;
}
