export type SettlementAmounts = {
  grossMinor: number;
  processingCostMinor: number;
  withholdingMinor: number;
  adjustmentMinor: number;
  netMinor: number;
};

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
