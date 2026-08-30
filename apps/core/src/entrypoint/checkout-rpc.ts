import type {
  AbandonCheckoutAttemptRequest,
  AuthenticatedRequest,
  CheckoutEligibilityRequest,
  CheckoutQuoteCommandRequest,
  CheckoutQuoteRefreshRequest,
  DeliveryCycleRequest,
  FulfillmentOptionsRequest,
  SetCartItemRequest,
} from "@freshmarkets/contracts";
import { identifierSchema, positiveIntegerSchema } from "@freshmarkets/validation";
import { abandonCheckoutAttempt } from "../checkout/application/abandon-checkout-attempt";
import { listFulfillmentOptions } from "../checkout/application/list-fulfillment-options";
import { listDeliveryCycles } from "../commerce/cycle-queries";
import { activeMarketCode } from "../geography/market-defaults";
import { getCart, setCartItem } from "../checkout/application/cart";
import {
  createCheckoutQuote,
  refreshCustomerCheckoutQuote,
} from "../checkout/application/create-checkout-quote";
import { evaluateCheckout } from "../checkout/application/evaluate-checkout";
import { createCheckoutRepository } from "../checkout/infrastructure/d1-checkout-repository";
import {
  abandonCheckoutAttemptSchema,
  authenticatedRequestSchema,
  checkoutRequestSchema,
  createCheckoutQuoteSchema,
  refreshCheckoutQuoteSchema,
  setCartItemRequestSchema,
} from "../validation";
import type { CoreRpcContext } from "./context";
import { validationFailure } from "./validation-errors";

export function createCheckoutRpc(context: CoreRpcContext) {
  return {
    listDeliveryCycles(input: DeliveryCycleRequest) {
      return listDeliveryCycles(
        context.env.DB,
        { marketCode: input.marketCode, requestId: input.requestId },
        () => activeMarketCode(context.env.DB),
      );
    },

    async getCart(input: AuthenticatedRequest) {
      const validation = authenticatedRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return getCart(context.env.DB, { ...input, customerId: customer.value.customerId });
    },

    async setCartItem(input: SetCartItemRequest) {
      const validation = setCartItemRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return setCartItem(context.env.DB, { ...input, customerId: customer.value.customerId });
    },

    async evaluateCheckout(input: CheckoutEligibilityRequest) {
      const validation = checkoutRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return evaluateCheckout(context.env.DB, {
        ...input,
        customerId: customer.value.customerId,
      });
    },

    async createCheckoutQuote(input: CheckoutQuoteCommandRequest) {
      const validation = createCheckoutQuoteSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      const existing = await createCheckoutRepository(context.env.DB).findQuoteByIdempotencyKey(
        input.idempotencyKey,
      );
      if (existing) {
        return createCheckoutQuote(
          context.env.DB,
          {
            customerId: customer.value.customerId,
            cartId: input.cartId,
            cartVersion: input.cartVersion,
            addressId: input.addressId,
            deliveryCycleId: existing.deliveryCycleId,
            fulfillmentOptionId: input.fulfillmentOptionId,
            promotionCodes: input.promotionCodes,
            idempotencyKey: input.idempotencyKey,
            requestId: input.requestId,
          },
          { routeDistance: context.routeDistance() },
        );
      }
      const options = await listFulfillmentOptions(context.env.DB, context.routeDistance(), {
        customerId: customer.value.customerId,
        addressId: input.addressId,
        cartId: input.cartId,
        cartVersion: input.cartVersion,
        requestId: input.requestId,
      });
      if (!options.ok) return options;
      const selected = options.value.find(
        (option) => option.optionId === input.fulfillmentOptionId,
      );
      if (!selected || !selected.eligible)
        return {
          ok: false as const,
          error: {
            code: "STALE_VERSION" as const,
            message: "Fulfillment option changed; choose a current option",
            requestId: input.requestId,
          },
        };
      return createCheckoutQuote(
        context.env.DB,
        {
          customerId: customer.value.customerId,
          cartId: input.cartId,
          cartVersion: input.cartVersion,
          addressId: input.addressId,
          deliveryCycleId: selected.mode === "SCHEDULED" ? selected.cycleId : null,
          fulfillmentOptionId: input.fulfillmentOptionId,
          promotionCodes: input.promotionCodes,
          idempotencyKey: input.idempotencyKey,
          requestId: input.requestId,
        },
        { routeDistance: context.routeDistance() },
      );
    },

    async listFulfillmentOptions(input: FulfillmentOptionsRequest) {
      const validation = authenticatedRequestSchema
        .extend({
          addressId: identifierSchema,
          addressVersion: positiveIntegerSchema,
          cartId: identifierSchema,
          cartVersion: positiveIntegerSchema,
        })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return listFulfillmentOptions(context.env.DB, context.routeDistance(), {
        ...validation.data,
        customerId: customer.value.customerId,
      });
    },

    async refreshCheckoutQuote(input: CheckoutQuoteRefreshRequest) {
      const validation = refreshCheckoutQuoteSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return refreshCustomerCheckoutQuote(context.env.DB, {
        quoteId: input.quoteId,
        expectedVersion: input.expectedVersion,
        requestId: input.requestId,
        customerId: customer.value.customerId,
      });
    },

    async abandonCheckoutAttempt(input: AbandonCheckoutAttemptRequest) {
      const validation = abandonCheckoutAttemptSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return abandonCheckoutAttempt(context.env.DB, {
        customerId: customer.value.customerId,
        quoteId: validation.data.quoteId,
        expectedVersion: validation.data.expectedVersion,
        idempotencyKey: validation.data.idempotencyKey,
        requestId: input.requestId,
      });
    },
  };
}
