import { describe, expect, it } from "vitest";
import indexSource from "../index.ts?raw";

describe("Core entrypoint composition boundary", () => {
  it("keeps extracted non-Admin/non-Maps groups as forwarding methods", () => {
    expect(indexSource).toContain("return this.authRpc.auth(input)");
    expect(indexSource).toContain("return this.catalogRpc.searchCatalog(input)");
    expect(indexSource).toContain("return this.membershipRpc.startTrial(input)");
    expect(indexSource).toContain("return this.checkoutRpc.createCheckoutQuote(input)");
    expect(indexSource).toContain("return this.paymentsRpc.createPaymentIntent(input)");
    expect(indexSource).toContain("return this.ordersRpc.listCustomerOrders(input)");
    expect(indexSource).toContain("return this.ordersRpc.getCustomerOrderDetail(input)");
    expect(indexSource).toContain("return this.ordersRpc.reorderOrder(input)");
    expect(indexSource).toContain("return this.ordersRpc.listCustomerOrderIssues(input)");
    expect(indexSource).toContain("return this.ordersRpc.submitCustomerOrderIssue(input)");
    expect(indexSource).toContain("return this.operationsRpc.adjustInventory(input)");
  });

  it("contains no SQL and no extracted transport schema imports", () => {
    expect(indexSource).not.toContain(".prepare(");
    expect(indexSource).not.toMatch(
      /createCheckoutQuoteSchema|createPaymentIntentSchema|inventoryAdjustmentSchema|setCartItemRequestSchema/u,
    );
  });

  it("leaves the explicitly excluded Admin and Maps transports in place", () => {
    expect(indexSource).toContain("async getAdminContext(");
    expect(indexSource).toContain("async searchAddressCandidates(");
    expect(indexSource).toContain("async getDeliveryMap(");
  });
});
