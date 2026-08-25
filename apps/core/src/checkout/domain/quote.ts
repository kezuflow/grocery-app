export type QuoteLine = {
  skuId: string;
  productId: string;
  productName: string;
  variantName: string;
  unit: string;
  quantity: number;
  baseQuantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  sourcingMode: "STOCKED" | "PLANNED_PROCUREMENT" | "HYBRID";
};

export type QuoteMoney = {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
};

export const QUOTE_TTL_MS = 15 * 60 * 1000;

export function isQuoteExpired(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs <= nowMs;
}
