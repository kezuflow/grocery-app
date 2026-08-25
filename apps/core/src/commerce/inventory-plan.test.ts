import { describe, expect, it } from "vitest";
import { buildInventoryCommitPlan } from "./inventory-plan";

describe("inventory commitment planning", () => {
  it("aggregates multiple SKUs that consume one shared inventory pool", () => {
    const result = buildInventoryCommitPlan(
      [
        { inventoryPoolId: "onion", requestedBase: 500, sourcingMode: "HYBRID" },
        { inventoryPoolId: "onion", requestedBase: 1000, sourcingMode: "HYBRID" },
      ],
      [{ inventoryPoolId: "onion", onHand: 1200, reserved: 200 }],
    );

    expect(result.plans).toEqual([
      {
        inventoryPoolId: "onion",
        sourcingMode: "HYBRID",
        requestedBase: 1500,
        reservedBase: 1000,
        plannedBase: 500,
      },
    ]);
  });

  it("rejects a stocked requirement when available stock is insufficient", () => {
    const result = buildInventoryCommitPlan(
      [{ inventoryPoolId: "stocked", requestedBase: 10, sourcingMode: "STOCKED" }],
      [{ inventoryPoolId: "stocked", onHand: 12, reserved: 3 }],
    );

    expect(result.insufficientStock).toEqual(["stocked"]);
  });

  it("routes planned-procurement demand without creating a stock hold", () => {
    const result = buildInventoryCommitPlan(
      [{ inventoryPoolId: "eggs", requestedBase: 12, sourcingMode: "PLANNED_PROCUREMENT" }],
      [],
    );

    expect(result.plans[0]).toMatchObject({ reservedBase: 0, plannedBase: 12 });
  });
});
