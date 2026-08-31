import type {
  AuthenticatedRequest,
  CancelCustomerOrderRequest,
  CustomerOrderDetailRequest,
  CreateOrderAmendmentRequest,
  ListCustomerOrderIssuesRequest,
  ProvisionalTransactionSummaryRequest,
  ReorderOrderRequest,
  SubmitCustomerOrderIssueRequest,
  AppErrorCode,
  OrderCancellationView,
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
import { requestOrderCancellation } from "../orders/application/cancel-order";
import { requestRefund } from "../payments/application/request-refund";
import { getProvisionalTransactionSummary } from "../orders/application/get-provisional-transaction-summary";
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
    async getProvisionalTransactionSummary(input: ProvisionalTransactionSummaryRequest) {
      const validation = authenticatedRequestSchema
        .extend({ orderId: identifierSchema })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return getProvisionalTransactionSummary(context.env.DB, {
        customerId: customer.value.customerId,
        orderId: validation.data.orderId,
        requestId: input.requestId,
      });
    },
    async cancelCustomerOrder(input: CancelCustomerOrderRequest) {
      const validation = authenticatedRequestSchema
        .extend({
          orderId: identifierSchema,
          expectedVersion: positiveIntegerSchema,
          reason: z.string().trim().min(1).max(500),
          idempotencyKey: idempotencyKeySchema,
        })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      const result = await requestOrderCancellation(
        context.env.DB,
        {
          orderId: validation.data.orderId,
          expectedVersion: validation.data.expectedVersion,
          reason: validation.data.reason,
          actor: "CUSTOMER",
          cause: "CUSTOMER_REQUEST",
          customerId: customer.value.customerId,
          idempotencyKey: validation.data.idempotencyKey,
          requestId: input.requestId,
        },
        {
          requestRefund: async (refundInput) => {
            const refund = await requestRefund(context.env.DB, context.paymentProviders(), {
              ...refundInput,
              actorId: customer.value.user.id,
              requestId: input.requestId,
            });
            return refund.ok
              ? {
                  ok: true as const,
                  refundId: refund.value.refundId,
                  refundState: refund.value.state,
                }
              : { ok: false as const, refundState: "REJECTED" as const };
          },
        },
      );
      if (!result.ok)
        return {
          ok: false as const,
          error: { ...result.error, code: result.error.code as AppErrorCode },
        };
      if (
        !result.value.cancellationId ||
        !result.value.status ||
        result.value.requiredRefundMinor === undefined ||
        result.value.retainedServiceFeeMinor === undefined ||
        !result.value.currency ||
        !result.value.refunds
      )
        return {
          ok: false as const,
          error: {
            code: "INTERNAL_ERROR" as const,
            message: "Cancellation result is incomplete",
            requestId: input.requestId,
          },
        };
      const value: OrderCancellationView = {
        cancellationId: result.value.cancellationId,
        status: result.value.status,
        requiredRefundMinor: result.value.requiredRefundMinor,
        retainedServiceFeeMinor: result.value.retainedServiceFeeMinor,
        currency: result.value.currency,
        refunds: result.value.refunds,
      };
      return { ok: true as const, value, requestId: input.requestId };
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
