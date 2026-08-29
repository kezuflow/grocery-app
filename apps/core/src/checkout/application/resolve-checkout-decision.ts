import { assertQuoteFinancialSnapshot, type QuoteFinancialSnapshot } from "../domain/quote";

export type CheckoutDecisionFailure = "CONFIGURATION_ERROR" | "MINIMUM_ORDER_NOT_MET";

export type CheckoutDecision<T> = {
  eligible: boolean;
  failures: CheckoutDecisionFailure[];
  minimumBasketMinor: number | null;
  currency: string;
  financial: QuoteFinancialSnapshot;
  evidence: Readonly<T> | null;
};

/**
 * Final authoritative gate for a fully resolved checkout draft. The caller
 * supplies priced, routed, mode-specific evidence; this policy verifies the
 * canonical market currency and applies the basket minimum to merchandise
 * before discounts. Delivery, fees, and tax can never satisfy that minimum.
 */
export async function resolveCheckoutDecision<T>(
  database: D1Database,
  input: {
    marketId: string;
    financial: QuoteFinancialSnapshot;
    evidence: T;
  },
): Promise<CheckoutDecision<T>> {
  const policy = await database
    .prepare(
      `SELECT mcp.minimum_basket_minor, mcp.currency
       FROM market_commerce_policy mcp
       JOIN market m ON m.id=mcp.market_id AND m.status='active'
       WHERE mcp.market_id=?`,
    )
    .bind(input.marketId)
    .first<{ minimum_basket_minor: number; currency: string }>();

  const failures: CheckoutDecisionFailure[] = [];
  if (input.financial.currency) assertQuoteFinancialSnapshot(input.financial);
  if (!policy || !input.financial.currency || policy.currency !== input.financial.currency)
    failures.push("CONFIGURATION_ERROR");
  if (policy && input.financial.merchandiseSubtotalMinor < policy.minimum_basket_minor)
    failures.push("MINIMUM_ORDER_NOT_MET");

  return {
    eligible: failures.length === 0,
    failures,
    minimumBasketMinor: policy?.minimum_basket_minor ?? null,
    currency: policy?.currency ?? "",
    financial: input.financial,
    evidence: failures.length === 0 ? Object.freeze(input.evidence) : null,
  };
}
