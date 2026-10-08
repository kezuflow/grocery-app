import type { ScheduledPurchaseQuantity } from "@freshmarkets/contracts";

/** Paid size snapshots on older gram-backed offers represent individually sold produce. */
export function scheduledPurchaseQuantity(input: {
  variantName: string;
  baseUnit: "GRAM" | "MILLILITER" | "PIECE";
  soldUnitCount: number;
  totalQuantityBase: number;
}): ScheduledPurchaseQuantity {
  const size = /^(small|medium|large)$/i.exec(input.variantName.trim());
  const sizeLabel = size ? size[1]![0]!.toUpperCase() + size[1]!.slice(1).toLowerCase() : null;
  return {
    sizeLabel,
    unit: sizeLabel && input.baseUnit === "GRAM" ? "PIECE" : input.baseUnit,
    quantity:
      sizeLabel && input.baseUnit === "GRAM" ? input.soldUnitCount : input.totalQuantityBase,
  };
}
