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
};

export type QuoteMoney = {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
};

export type QuoteFinancialSnapshot = {
  merchandiseSubtotalMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  deliverySubtotalMinor: number;
  deliveryDiscountMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
};

export function assertQuoteFinancialSnapshot(financial: QuoteFinancialSnapshot): void {
  const integerComponents = [
    financial.merchandiseSubtotalMinor,
    financial.itemDiscountMinor,
    financial.orderDiscountMinor,
    financial.deliverySubtotalMinor,
    financial.deliveryDiscountMinor,
    financial.serviceFeeMinor,
    financial.taxMinor,
    financial.totalMinor,
  ];
  if (integerComponents.some((component) => !Number.isInteger(component) || component < 0))
    throw new Error("QUOTE_FINANCIAL_COMPONENT_INVALID");
  if (!financial.currency.trim()) throw new Error("QUOTE_CURRENCY_REQUIRED");
  if (
    financial.itemDiscountMinor + financial.orderDiscountMinor >
      financial.merchandiseSubtotalMinor ||
    financial.deliveryDiscountMinor > financial.deliverySubtotalMinor
  )
    throw new Error("QUOTE_FINANCIAL_DISCOUNT_INVALID");
  const expectedTotal =
    financial.merchandiseSubtotalMinor -
    financial.itemDiscountMinor -
    financial.orderDiscountMinor +
    financial.deliverySubtotalMinor -
    financial.deliveryDiscountMinor +
    financial.serviceFeeMinor +
    financial.taxMinor;
  if (expectedTotal !== financial.totalMinor) throw new Error("QUOTE_FINANCIAL_TOTAL_INVALID");
}

export const QUOTE_TTL_MS = 15 * 60 * 1000;

export function isQuoteExpired(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs <= nowMs;
}
