import { assertQuoteFinancialSnapshot, type QuoteFinancialSnapshot } from "../domain/quote";

export type CheckoutDecisionFailure = "CONFIGURATION_ERROR";

export type CheckoutDecision<T> = {
  eligible: boolean;
  failures: CheckoutDecisionFailure[];
  minimumBasketMinor: number | null;
  currency: string;
  financial: QuoteFinancialSnapshot;
  evidence: Readonly<T> | null;
};

/** Validates the active market currency; nonempty carts have no general spending minimum. */
export async function resolveCheckoutDecision<T>(
  database: D1Database,
  input: {
    marketId: string;
    financial: QuoteFinancialSnapshot;
    evidence: T;
  },
): Promise<CheckoutDecision<T>> {
  const policy = await database
    .prepare("SELECT currency FROM market WHERE id=? AND status='active'")
    .bind(input.marketId)
    .first<{ currency: string }>();

  const failures: CheckoutDecisionFailure[] = [];
  if (input.financial.currency) assertQuoteFinancialSnapshot(input.financial);
  if (!policy || !input.financial.currency || policy.currency !== input.financial.currency)
    failures.push("CONFIGURATION_ERROR");

  return {
    eligible: failures.length === 0,
    failures,
    minimumBasketMinor: null,
    currency: policy?.currency ?? "",
    financial: input.financial,
    evidence: failures.length === 0 ? Object.freeze(input.evidence) : null,
  };
}
