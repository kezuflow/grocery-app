import type {
  AuthenticatedRequest,
  CustomerOrderDetailRequest,
  ReorderOrderRequest,
} from "@freshmarkets/contracts";
import {
  idempotencyKeySchema,
  identifierSchema,
  positiveIntegerSchema,
} from "@freshmarkets/validation";
import { authenticatedRequestSchema } from "../validation";
import { listCustomerOrders } from "../orders/application/list-customer-orders";
import { getCustomerOrderDetail } from "../orders/application/get-customer-order-detail";
import { reorderOrder } from "../orders/application/reorder-order";
import type { CoreRpcContext } from "./context";
import { validationFailure } from "./validation-errors";

export function createOrdersRpc(context: CoreRpcContext) {
  return {
    async listCustomerOrders(input: AuthenticatedRequest) {
      const validation = authenticatedRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return listCustomerOrders(context.env.DB, {
        customerId: customer.value.customerId,
        requestId: input.requestId,
      });
    },
    async getCustomerOrderDetail(input: CustomerOrderDetailRequest) {
      const validation = authenticatedRequestSchema
        .extend({ orderId: identifierSchema })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return getCustomerOrderDetail(context.env.DB, {
        customerId: customer.value.customerId,
        orderId: validation.data.orderId,
        requestId: input.requestId,
      });
    },
    async reorderOrder(input: ReorderOrderRequest) {
      const validation = authenticatedRequestSchema
        .extend({
          orderId: identifierSchema,
          expectedCartVersion: positiveIntegerSchema,
          idempotencyKey: idempotencyKeySchema,
        })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return reorderOrder(context.env.DB, {
        ...input,
        orderId: validation.data.orderId,
        expectedCartVersion: validation.data.expectedCartVersion,
        idempotencyKey: validation.data.idempotencyKey,
        customerId: customer.value.customerId,
      });
    },
  };
}
