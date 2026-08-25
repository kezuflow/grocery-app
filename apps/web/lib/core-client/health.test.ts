import { describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type CoreServiceBinding } from "@freshmarkets/contracts";
import { getCoreHealth } from "./health";

describe("Web Core client", () => {
  it("delegates health through the typed Core binding", async () => {
    const health = vi.fn(async () => ({
      service: "core" as const,
      status: "ok" as const,
      contractVersion: CONTRACT_VERSION,
      environment: "test",
      databaseBindingConfigured: true,
      timestamp: new Date(0).toISOString(),
    }));
    const core: CoreServiceBinding = {
      health,
      auth: vi.fn(),
      getApplicationContext: vi.fn(),
      resolveServiceability: vi.fn(),
      searchCatalog: vi.fn(),
      getCatalogProduct: vi.fn(),
      listCategories: vi.fn(),
      createCustomerAddress: vi.fn(),
      listCustomerAddresses: vi.fn(),
      updateCustomerAddress: vi.fn(),
      getSubscriptionEligibility: vi.fn(),
      listDeliveryCycles: vi.fn(),
      evaluateCheckout: vi.fn(),
      commitMockOrder: vi.fn(),
      startTrial: vi.fn(),
      getCart: vi.fn(),
      setCartItem: vi.fn(),
      listCustomerOrders: vi.fn(),
      advanceOrder: vi.fn(),
      adjustInventory: vi.fn(),
      createProcurementRequirement: vi.fn(),
      receiveProcurement: vi.fn(),
      advanceFulfillment: vi.fn(),
      advanceDelivery: vi.fn(),
    };

    const response = await getCoreHealth(core, "web-test-request");

    expect(health).toHaveBeenCalledWith({ requestId: "web-test-request" });
    expect(response.status).toBe("ok");
  });
});
