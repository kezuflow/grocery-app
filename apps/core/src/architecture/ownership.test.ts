import { describe, expect, it } from "vitest";
import { CoreEntrypoint } from "../index";
import { betterAuthSchema } from "../auth/schema";
import { iamSchema } from "../iam/schema";
import * as customerAddresses from "../customer/addresses";
import * as customerPrincipal from "../customer/principal";
import * as marketDefaults from "../geography/market-defaults";
import * as subscriptionEligibility from "../membership/application/subscription-eligibility";
import * as cycleQueries from "../commerce/cycle-queries";
import * as cart from "../checkout/application/cart";
import * as evaluateCheckout from "../checkout/application/evaluate-checkout";
import * as listCustomerOrders from "../orders/application/list-customer-orders";
import * as createProcurementRequirement from "../procurement/application/create-procurement-requirement";
import * as receiveProcurement from "../procurement/application/receive-procurement";
import * as advanceFulfillment from "../operations/application/advance-fulfillment";
import * as advanceDelivery from "../operations/application/advance-delivery";

describe("core architecture ownership (runtime checks)", () => {
  it("exposes no mock commitment surface on the entrypoint", () => {
    expect("commitMockOrder" in CoreEntrypoint.prototype).toBe(false);
  });

  it("keeps Better Auth adapter tables separate from application IAM tables", () => {
    expect(Object.keys(betterAuthSchema).sort()).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
    expect(Object.keys(iamSchema).sort()).toEqual([
      "customerPrincipal",
      "permission",
      "role",
      "rolePermission",
      "staffIdentity",
      "staffRole",
      "staffScope",
    ]);
  });

  it("owns domain commands in bounded-context modules, not the entrypoint", () => {
    expect(typeof customerAddresses.createCustomerAddress).toBe("function");
    expect(typeof customerAddresses.listCustomerAddresses).toBe("function");
    expect(typeof customerAddresses.updateCustomerAddress).toBe("function");
    expect(typeof customerPrincipal.resolveAuthenticatedCustomer).toBe("function");
    expect(typeof marketDefaults.activeMarketCode).toBe("function");
    expect(typeof marketDefaults.activeFulfillmentLocationId).toBe("function");
    expect(typeof marketDefaults.defaultCurrency).toBe("function");
    expect(typeof subscriptionEligibility.getSubscriptionEligibility).toBe("function");
    expect(typeof cycleQueries.listDeliveryCycles).toBe("function");
    expect(typeof cart.getCart).toBe("function");
    expect(typeof cart.setCartItem).toBe("function");
    expect(typeof evaluateCheckout.evaluateCheckout).toBe("function");
    expect(typeof listCustomerOrders.listCustomerOrders).toBe("function");
    expect(typeof createProcurementRequirement.createProcurementRequirement).toBe("function");
    expect(typeof receiveProcurement.receiveProcurement).toBe("function");
    expect(typeof advanceFulfillment.advanceFulfillment).toBe("function");
    expect(typeof advanceDelivery.advanceDelivery).toBe("function");
  });

  it("keeps principal resolution, capability checks, and idempotency claims off the entrypoint prototype", () => {
    for (const privateHelper of [
      "resolveAuthenticatedCustomer",
      "requireCapability",
      "requireOperationalAccess",
      "claimCommandIdempotency",
      "activeMarketCode",
      "activeFulfillmentLocationId",
      "defaultCurrency",
    ]) {
      expect(privateHelper in CoreEntrypoint.prototype).toBe(false);
    }
  });
});
