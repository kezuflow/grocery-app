import type {
  AbandonCheckoutAttemptRequest,
  AuthenticatedRequest,
  CheckoutEligibilityRequest,
  CheckoutQuoteCommandRequest,
  CheckoutQuoteRefreshRequest,
  DeliveryCycleRequest,
  SetCartItemRequest,
} from "@freshmarkets/contracts";
import { abandonCheckoutAttempt } from "../checkout/application/abandon-checkout-attempt";
import { listDeliveryCycles } from "../commerce/cycle-queries";
import { activeMarketCode } from "../geography/market-defaults";
import { getCart, setCartItem } from "../checkout/application/cart";
import {
  createCheckoutQuote,
  refreshCustomerCheckoutQuote,
} from "../checkout/application/create-checkout-quote";
import { evaluateCheckout } from "../checkout/application/evaluate-checkout";
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
      return createCheckoutQuote(
        context.env.DB,
        {
          customerId: customer.value.customerId,
          cartId: input.cartId,
          cartVersion: input.cartVersion,
          addressId: input.addressId,
          deliveryCycleId: input.deliveryCycleId,
          promotionCodes: input.promotionCodes,
          idempotencyKey: input.idempotencyKey,
          requestId: input.requestId,
        },
        { routeDistance: context.routeDistance() },
      );
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
