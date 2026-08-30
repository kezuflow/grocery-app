export type InvoiceFinancialFacts = {
  currency: string;
  merchandiseSubtotalMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  deliverySubtotalMinor: number;
  deliveryDiscountMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
};

export function invoiceReadiness(input: {
  financial: InvoiceFinancialFacts;
  sellerSnapshot: Record<string, unknown> | null;
  buyerSnapshot: Record<string, unknown>;
  taxPolicyVersion: string | null;
  taxClassifications: Record<string, unknown> | null;
}) {
  const values = Object.values(input.financial).filter(
    (value): value is number => typeof value === "number",
  );
  if (values.some((value) => !Number.isInteger(value) || value < 0))
    return { ok: false as const, code: "INVALID_FINANCIAL_FACTS" };
  const expected =
    input.financial.merchandiseSubtotalMinor -
    input.financial.itemDiscountMinor -
    input.financial.orderDiscountMinor +
    input.financial.deliverySubtotalMinor -
    input.financial.deliveryDiscountMinor +
    input.financial.serviceFeeMinor +
    input.financial.taxMinor;
  if (expected !== input.financial.totalMinor)
    return { ok: false as const, code: "INCONSISTENT_FINANCIAL_FACTS" };
  if (
    JSON.stringify(input.buyerSnapshot).length > 16_384 ||
    JSON.stringify(input.sellerSnapshot).length > 16_384
  )
    return { ok: false as const, code: "SNAPSHOT_TOO_LARGE" };
  const ready = Boolean(input.sellerSnapshot && input.taxPolicyVersion && input.taxClassifications);
  return {
    ok: true as const,
    status: ready ? ("READY_FOR_ISSUANCE" as const) : ("PENDING_TAX_CONFIGURATION" as const),
    blockedReason: ready ? null : "APPROVED_TAX_CONFIGURATION_REQUIRED",
  };
}
