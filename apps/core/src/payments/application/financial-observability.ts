import type { ProviderSettlementObservation } from "../ports/payment-provider";

type SettlementAmounts = Pick<
  ProviderSettlementObservation,
  | "grossMinor"
  | "processingCostMinor"
  | "withholdingMinor"
  | "adjustmentMinor"
  | "netMinor"
>;

export function validateSettlement(settlement: SettlementAmounts): boolean {
  const amounts = [
    settlement.grossMinor,
    settlement.processingCostMinor,
    settlement.withholdingMinor,
    settlement.adjustmentMinor,
    settlement.netMinor,
  ];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) return false;

  return (
    BigInt(settlement.netMinor) ===
    BigInt(settlement.grossMinor) -
      BigInt(settlement.processingCostMinor) -
      BigInt(settlement.withholdingMinor) +
      BigInt(settlement.adjustmentMinor)
  );
}

export type FinancialEventName =
  | "payment_command_replayed"
  | "payment_action_expired"
  | "payment_outcome_unresolved"
  | "authorization_command_replayed"
  | "authorization_action_expired"
  | "authorization_outcome_unresolved"
  | "refund_budget_rejected"
  | "refund_outcome_unresolved"
  | "provider_observation_replayed"
  | "provider_observation_retry_required"
  | "provider_observation_reconciliation_required"
  | "paid_commitment_conflict";

export type FinancialEventInput = {
  event: FinancialEventName;
  requestId?: string;
  scope: string;
  provider?: string;
  aggregateId?: string;
  attemptCount?: number;
  outcomeCode?: string;
  ageMs?: number;
  durationMs?: number;
};

export type SafeFinancialEvent = Partial<Omit<FinancialEventInput, "event" | "scope">> &
  Pick<FinancialEventInput, "event" | "scope">;

/**
 * Closed, redacted financial telemetry boundary. Runtime callers may carry
 * provider payloads or browser continuation secrets, but only this explicit
 * scalar vocabulary can cross into logs.
 */
export function recordFinancialEvent(input: FinancialEventInput): SafeFinancialEvent {
  const output: SafeFinancialEvent = { event: input.event, scope: input.scope };
  if (input.requestId !== undefined) output.requestId = input.requestId;
  if (input.provider !== undefined) output.provider = input.provider;
  if (input.aggregateId !== undefined) output.aggregateId = input.aggregateId;
  if (input.attemptCount !== undefined) output.attemptCount = input.attemptCount;
  if (input.outcomeCode !== undefined) output.outcomeCode = input.outcomeCode;
  if (input.ageMs !== undefined) output.ageMs = input.ageMs;
  if (input.durationMs !== undefined) output.durationMs = input.durationMs;
  console.info(JSON.stringify(output));
  return output;
}
