import type {
  AuthenticatedRequest,
  OrderFeedbackRequest,
  SetSavedProductRequest,
  SubmitOrderFeedbackRequest,
} from "@freshmarkets/contracts";
import { identifierSchema, z } from "@freshmarkets/validation";
import {
  getOrderFeedback,
  listSavedProducts,
  listPopularWithCart,
  setSavedProduct,
  submitOrderFeedback,
} from "../customer/engagement";
import { authenticatedRequestSchema } from "../validation";
import type { CoreRpcContext } from "./context";
import { validationFailure } from "./validation-errors";

const savedProductRequestSchema = authenticatedRequestSchema.extend({
  productId: identifierSchema,
  saved: z.boolean(),
});
const feedbackRequestSchema = authenticatedRequestSchema.extend({ orderId: identifierSchema });
const submitFeedbackRequestSchema = feedbackRequestSchema.extend({
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  comment: z.string().trim().max(1000).nullable(),
});

export function createCustomerEngagementRpc(context: CoreRpcContext) {
  return {
    async listSavedProducts(input: AuthenticatedRequest) {
      const parsed = authenticatedRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailure(input.requestId, parsed.error);
      const customer = await context.access.resolveAuthenticatedCustomer(parsed.data);
      if (!customer.ok) return customer;
      return listSavedProducts(context.env.DB, customer.value.customerId, input.requestId);
    },
    async listPopularWithCart(input: AuthenticatedRequest) {
      const parsed = authenticatedRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailure(input.requestId, parsed.error);
      const customer = await context.access.resolveAuthenticatedCustomer(parsed.data);
      if (!customer.ok) return customer;
      return listPopularWithCart(context.env.DB, customer.value.customerId, input.requestId);
    },
    async setSavedProduct(input: SetSavedProductRequest) {
      const parsed = savedProductRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailure(input.requestId, parsed.error);
      const customer = await context.access.resolveAuthenticatedCustomer(parsed.data);
      if (!customer.ok) return customer;
      return setSavedProduct(context.env.DB, {
        customerId: customer.value.customerId,
        productId: parsed.data.productId,
        saved: parsed.data.saved,
        requestId: input.requestId,
      });
    },
    async getOrderFeedback(input: OrderFeedbackRequest) {
      const parsed = feedbackRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailure(input.requestId, parsed.error);
      const customer = await context.access.resolveAuthenticatedCustomer(parsed.data);
      if (!customer.ok) return customer;
      return getOrderFeedback(context.env.DB, {
        customerId: customer.value.customerId,
        orderId: parsed.data.orderId,
        requestId: input.requestId,
      });
    },
    async submitOrderFeedback(input: SubmitOrderFeedbackRequest) {
      const parsed = submitFeedbackRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailure(input.requestId, parsed.error);
      const customer = await context.access.resolveAuthenticatedCustomer(parsed.data);
      if (!customer.ok) return customer;
      return submitOrderFeedback(context.env.DB, {
        customerId: customer.value.customerId,
        orderId: parsed.data.orderId,
        rating: parsed.data.rating,
        comment: parsed.data.comment,
        requestId: input.requestId,
      });
    },
  };
}
