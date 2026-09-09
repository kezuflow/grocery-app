import type {
  AmendmentPaymentIntentRequest,
  BeginRecurringAuthorizationRequest,
  CompleteRecurringAuthorizationRequest,
  PaymentIntentCommandRequest,
} from "@freshmarkets/contracts";
import { idempotencyKeySchema, z as validationSchema } from "@freshmarkets/validation";
import { createCheckoutPaymentIntent } from "../payments/application/create-checkout-payment-intent";
import { createAmendmentPaymentIntent } from "../payments/application/create-amendment-payment-intent";
import { authenticatedRequestSchema, createPaymentIntentSchema } from "../validation";
import type { CoreRpcContext } from "./context";
import { rpcFailure, validationFailure } from "./validation-errors";

export function createPaymentsRpc(context: CoreRpcContext) {
  return {
    async beginRecurringAuthorization(input: BeginRecurringAuthorizationRequest) {
      const validation = authenticatedRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return rpcFailure(
        "ILLEGAL_TRANSITION",
        "Recurring membership enrollment is no longer available",
        input.requestId,
      );
    },

    async completeRecurringAuthorization(input: CompleteRecurringAuthorizationRequest) {
      const validation = authenticatedRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return rpcFailure(
        "ILLEGAL_TRANSITION",
        "Recurring membership enrollment is no longer available",
        input.requestId,
      );
    },

    async createPaymentIntent(input: PaymentIntentCommandRequest) {
      const validation = createPaymentIntentSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const providerCode = context.paymentProviderCode();
      if (!providerCode || (input.providerCode && input.providerCode !== providerCode))
        return rpcFailure(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "A payment provider is not configured for this environment.",
          input.requestId,
        );
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return createCheckoutPaymentIntent(
        context.env.DB,
        context.paymentProviders(),
        providerCode,
        context.routeDistance(),
        { ...input, customerId: customer.value.customerId },
        context.deliveryProviders(),
      );
    },

    async createAmendmentPaymentIntent(input: AmendmentPaymentIntentRequest) {
      const validation = authenticatedRequestSchema
        .extend({
          amendmentId: validationSchema.string().trim().min(1).max(128),
          expectedAmendmentVersion: validationSchema.number().int().positive(),
          expectedCurrency: validationSchema.string().trim().length(3),
          expectedTotalMinor: validationSchema.number().int().positive(),
          providerCode: validationSchema.string().trim().min(1).optional(),
          returnUrl: validationSchema.string().url().max(2000),
          idempotencyKey: idempotencyKeySchema,
        })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const providerCode = context.paymentProviderCode();
      if (!providerCode || (input.providerCode && input.providerCode !== providerCode))
        return rpcFailure(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "A payment provider is not configured for this environment.",
          input.requestId,
        );
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return createAmendmentPaymentIntent(
        context.env.DB,
        context.paymentProviders(),
        providerCode,
        {
          ...validation.data,
          customerId: customer.value.customerId,
          requestId: input.requestId,
        },
      );
    },
  };
}
