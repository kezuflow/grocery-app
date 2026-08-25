export type SourcingMode = "STOCKED" | "PLANNED_PROCUREMENT" | "HYBRID";

export type InventoryRequirementInput = {
  inventoryPoolId: string;
  requestedBase: number;
  sourcingMode: SourcingMode;
};

export type InventoryBalanceInput = {
  inventoryPoolId: string;
  onHand: number;
  reserved: number;
};

export type InventoryCommitPlan = {
  inventoryPoolId: string;
  sourcingMode: SourcingMode;
  requestedBase: number;
  reservedBase: number;
  plannedBase: number;
};

export function buildInventoryCommitPlan(
  inputs: ReadonlyArray<InventoryRequirementInput>,
  balances: ReadonlyArray<InventoryBalanceInput>,
): { plans: ReadonlyArray<InventoryCommitPlan>; insufficientStock: ReadonlyArray<string> } {
  const grouped = new Map<string, { requestedBase: number; sourcingMode: SourcingMode }>();
  for (const input of inputs) {
    const current = grouped.get(input.inventoryPoolId);
    if (current && current.sourcingMode !== input.sourcingMode)
      throw new Error(`INCONSISTENT_SOURCING_MODE:${input.inventoryPoolId}`);
    grouped.set(input.inventoryPoolId, {
      requestedBase: (current?.requestedBase ?? 0) + input.requestedBase,
      sourcingMode: input.sourcingMode,
    });
  }

  const balanceByPool = new Map(balances.map((balance) => [balance.inventoryPoolId, balance]));
  const insufficientStock: string[] = [];
  const plans = [...grouped].map(([inventoryPoolId, requirement]) => {
    const balance = balanceByPool.get(inventoryPoolId);
    const available = Math.max(0, (balance?.onHand ?? 0) - (balance?.reserved ?? 0));
    if (requirement.sourcingMode === "STOCKED" && available < requirement.requestedBase)
      insufficientStock.push(inventoryPoolId);
    const reservedBase =
      requirement.sourcingMode === "PLANNED_PROCUREMENT"
        ? 0
        : requirement.sourcingMode === "STOCKED"
          ? requirement.requestedBase
          : Math.min(requirement.requestedBase, available);
    return {
      inventoryPoolId,
      sourcingMode: requirement.sourcingMode,
      requestedBase: requirement.requestedBase,
      reservedBase,
      plannedBase:
        requirement.sourcingMode === "STOCKED"
          ? 0
          : Math.max(0, requirement.requestedBase - reservedBase),
    };
  });
  return { plans, insufficientStock };
}
