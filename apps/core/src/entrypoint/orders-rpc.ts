import type { AuthenticatedRequest } from "@freshmarkets/contracts";
import { listCustomerOrders } from "../orders/application/list-customer-orders";
import type { CoreRpcContext } from "./context";

export function createOrdersRpc(context: CoreRpcContext) {
  return {
    async listCustomerOrders(input: AuthenticatedRequest) {
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return listCustomerOrders(context.env.DB, {
        customerId: customer.value.customerId,
        requestId: input.requestId,
      });
    },
  };
}
