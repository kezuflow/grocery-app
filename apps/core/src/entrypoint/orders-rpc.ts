import type {
  AuthenticatedRequest,
  CustomerOrderDetailRequest,
  CreateOrderAmendmentRequest,
  ListCustomerOrderIssuesRequest,
  ReorderOrderRequest,
  SubmitCustomerOrderIssueRequest,
} from "@freshmarkets/contracts";
import {
  idempotencyKeySchema,
  identifierSchema,
  positiveIntegerSchema,
  z,
} from "@freshmarkets/validation";
import { authenticatedRequestSchema } from "../validation";
import { listCustomerOrders } from "../orders/application/list-customer-orders";
import { getCustomerOrderDetail } from "../orders/application/get-customer-order-detail";
import { reorderOrder } from "../orders/application/reorder-order";
import { listCustomerOrderIssues } from "../orders/application/list-customer-order-issues";
import { submitCustomerOrderIssue } from "../orders/application/submit-customer-order-issue";
import { createOrderAmendment } from "../orders/application/create-order-amendment";
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
    async listCustomerOrderIssues(input: ListCustomerOrderIssuesRequest) {
      const validation = authenticatedRequestSchema
        .extend({ orderId: identifierSchema })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return listCustomerOrderIssues(context.env.DB, {
        customerId: customer.value.customerId,
        orderId: validation.data.orderId,
        requestId: input.requestId,
      });
    },
    async submitCustomerOrderIssue(input: SubmitCustomerOrderIssueRequest) {
      const validation = authenticatedRequestSchema
        .extend({
          orderId: identifierSchema,
          category: z.enum([
            "MISSING_ITEM",
            "WRONG_ITEM",
            "DAMAGED_ITEM",
            "POOR_QUALITY",
            "QUANTITY_DISCREPANCY",
            "DELIVERY_ISSUE",
            "OTHER",
          ]),
          description: z.string().trim().min(1).max(1000),
          affectedOrderItemIds: z.array(identifierSchema).max(50),
          idempotencyKey: idempotencyKeySchema,
        })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return submitCustomerOrderIssue(context.env.DB, {
        ...input,
        ...validation.data,
        customerId: customer.value.customerId,
      });
    },
    async createOrderAmendment(input: CreateOrderAmendmentRequest) {
      const validation = authenticatedRequestSchema
        .extend({
          orderId: identifierSchema,
          expectedOrderVersion: positiveIntegerSchema,
          additions: z
            .array(z.object({ skuId: identifierSchema, quantity: positiveIntegerSchema }))
            .min(1)
            .max(50),
          idempotencyKey: idempotencyKeySchema,
        })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return createOrderAmendment(context.env.DB, {
        ...validation.data,
        customerId: customer.value.customerId,
        requestId: input.requestId,
      });
    },
  };
}
