import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({ adjustInventory: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { CORE: coreMocks } }));

import { POST } from "@/app/api/admin/inventory/[inventory-pool-id]/adjustments/route";

const context = { params: Promise.resolve({ "inventory-pool-id": "pool-eggs" }) };

function request(body: unknown): Request {
  return new Request("https://app.test/api/admin/inventory/pool-eggs/adjustments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "session=admin",
      "idempotency-key": "stock-change-1",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => coreMocks.adjustInventory.mockReset());

describe("inventory adjustment route", () => {
  it.each([
    ["ADD", 12],
    ["REMOVE", -12],
  ] as const)(
    "maps %s with a positive quantity to Core's guarded delta",
    async (operation, delta) => {
      coreMocks.adjustInventory.mockResolvedValue({
        ok: true,
        value: { inventoryPoolId: "pool-eggs", onHandBase: 20 },
        requestId: "request-1",
      });

      const response = await POST(
        request({
          locationId: "location-cebu-central",
          operation,
          quantityBase: 12,
          reason: "physical count",
          expectedVersion: 3,
        }),
        context,
      );

      expect(response.status).toBe(200);
      expect(coreMocks.adjustInventory).toHaveBeenCalledWith(
        expect.objectContaining({
          locationId: "location-cebu-central",
          inventoryPoolId: "pool-eggs",
          delta,
          reason: "physical count",
          expectedVersion: 3,
          idempotencyKey: "stock-change-1",
        }),
      );
    },
  );

  it("rejects signed, zero, or missing quantities before Core", async () => {
    const response = await POST(
      request({
        locationId: "location-cebu-central",
        operation: "REMOVE",
        quantityBase: -1,
        reason: "physical count",
        expectedVersion: 3,
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(coreMocks.adjustInventory).not.toHaveBeenCalled();
  });
});
