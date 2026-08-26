export type FinancialOperationAction = "CANCEL" | "REFUND";

export type FinancialOperationDisposition =
  | "REQUIRES_CANONICAL_ORCHESTRATION"
  | "COMPATIBILITY_ALLOWED";

/**
 * Containment rule for compatibility order commands: refunds and cancellations
 * of paid committed orders must be orchestrated by the canonical Payments and
 * Checkout flows (Plans 05 and 07). Only a pre-commitment cancellation may run
 * through the compatibility path.
 */
export function financialOperationDisposition(
  action: FinancialOperationAction,
  orderStatus: string,
): FinancialOperationDisposition {
  if (action === "REFUND") return "REQUIRES_CANONICAL_ORCHESTRATION";
  if (orderStatus === "PENDING") return "COMPATIBILITY_ALLOWED";
  return "REQUIRES_CANONICAL_ORCHESTRATION";
}
