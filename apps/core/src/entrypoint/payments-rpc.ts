import type {
  AmendmentPaymentIntentRequest,
  BeginRecurringAuthorizationRequest,
  CompleteRecurringAuthorizationRequest,
  PaymentIntentCommandRequest,
} from "@freshmarkets/contracts";
import { idempotencyKeySchema, z as validationSchema } from "@freshmarkets/validation";
import { beginRecurringAuthorization } from "../payments/application/begin-recurring-authorization";
import { completeRecurringAuthorization } from "../payments/application/complete-recurring-authorization";
import { createCheckoutPaymentIntent } from "../payments/application/create-checkout-payment-intent";
import { createAmendmentPaymentIntent } from "../payments/application/create-amendment-payment-intent";
import { authenticatedRequestSchema, createPaymentIntentSchema } from "../validation";
import type { CoreRpcContext } from "./context";
import { rpcFailure, validationFailure } from "./validation-errors";

export function createPaymentsRpc(context: CoreRpcContext) {
  return {
    async beginRecurringAuthorization(input: BeginRecurringAuthorizationRequest) {
      const validation = authenticatedRequestSchema
        .extend({
          providerCode: validationSchema.string().optional(),
          currency: validationSchema.string().optional(),
          returnUrl: validationSchema.string().min(1),
          idempotencyKey: idempotencyKeySchema,
        })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      const providerCode = context.paymentProviderCode();
      if (
        !providerCode ||
        (validation.data.providerCode && validation.data.providerCode !== providerCode)
      )
        return rpcFailure(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "Recurring authorization is unavailable in this environment.",
          input.requestId,
        );
      return beginRecurringAuthorization(context.env.DB, context.paymentProviders(), {
        customerId: customer.value.customerId,
        providerCode,
        currency: validation.data.currency ?? "PHP",
        returnUrl: validation.data.returnUrl,
        idempotencyKey: validation.data.idempotencyKey,
        requestId: input.requestId,
      });
    },

    async completeRecurringAuthorization(input: CompleteRecurringAuthorizationRequest) {
      const validation = authenticatedRequestSchema
        .extend({ authorizationId: validationSchema.string().min(1) })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return completeRecurringAuthorization(context.env.DB, context.paymentProviders(), {
        customerId: customer.value.customerId,
        authorizationId: validation.data.authorizationId,
        requestId: input.requestId,
      });
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
