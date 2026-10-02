import { Platform } from "react-native";
import type {
  AbandonCheckoutResult,
  AddressSearchCandidate,
  CartLocationSelection,
  CartView,
  CheckoutBootstrapView,
  CheckoutQuoteView,
  CheckoutPaymentCompletionView,
  Coordinate,
  CustomerOrderDetailView,
  DeliveryTrackingView,
  CustomerAddressView,
  CustomerOrdersPage,
  FulfillmentOptionView,
  PaymentActionView,
  RpcResult,
  SavedProductView,
  OrderFeedbackView,
  PopularWithCartProductView,
} from "@freshmarkets/contracts";
import { authClient } from "./auth-client";

const apiOrigin = process.env.EXPO_PUBLIC_MOBILE_API_URL;

export class CommerceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function commerce<T>(path: string, body?: unknown): Promise<T> {
  if (!apiOrigin) throw new Error("Set EXPO_PUBLIC_MOBILE_API_URL to use your account.");
  const cookie = Platform.OS === "web" ? "" : await authClient.getCookie();
  let response: Response;
  try {
    response = await fetch(new URL(path, apiOrigin).toString(), {
      method: body === undefined ? "GET" : "POST",
      credentials: Platform.OS === "web" ? "include" : "omit",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not connect to FreshMarkets. Check your network and API URL.");
  }
  const result = (await response.json()) as RpcResult<T>;
  if (!response.ok || !result.ok)
    throw !result.ok
      ? new CommerceError(result.error.code, result.error.message || result.error.code)
      : new Error("Request failed.");
  return result.value;
}

export const getCart = () => commerce<CartView>("/v1/cart");

export const selectCartLocation = (coordinate: Coordinate, expectedVersion: number) =>
  commerce<CartLocationSelection>("/v1/cart/location", {
    ...coordinate,
    expectedVersion,
    idempotencyKey: crypto.randomUUID(),
  });

export const setCartItem = (cart: CartView, skuId: string, quantity: number) =>
  commerce<CartView>("/v1/cart", {
    cartId: cart.id,
    skuId,
    quantity,
    expectedVersion: cart.version,
    idempotencyKey: crypto.randomUUID(),
  });

export const getOrders = (filter: "all" | "active" | "completed" = "all", cursor?: string) => {
  const params = new URLSearchParams({ filter });
  if (cursor) params.set("cursor", cursor);
  return commerce<CustomerOrdersPage>(`/v1/orders?${params.toString()}`);
};

export const getOrder = (orderId: string) =>
  commerce<CustomerOrderDetailView>(`/v1/orders/${encodeURIComponent(orderId)}`);

export const getOrderTracking = (orderId: string) =>
  commerce<DeliveryTrackingView>(`/v1/orders/${encodeURIComponent(orderId)}/tracking`);

export const getFavorites = () => commerce<readonly SavedProductView[]>("/v1/favorites");
export const getPopularWithCart = () =>
  commerce<readonly PopularWithCartProductView[]>("/v1/cart/popular");
export const setFavorite = (productId: string, saved: boolean) =>
  commerce<{ saved: boolean }>("/v1/favorites", { productId, saved });

export const getOrderFeedback = (orderId: string) =>
  commerce<OrderFeedbackView | null>(`/v1/orders/${encodeURIComponent(orderId)}/feedback`);
export const submitOrderFeedback = (
  orderId: string,
  rating: OrderFeedbackView["rating"],
  comment: string | null,
) =>
  commerce<OrderFeedbackView>(`/v1/orders/${encodeURIComponent(orderId)}/feedback`, {
    rating,
    comment,
  });

export const getCheckoutBootstrap = () => commerce<CheckoutBootstrapView>("/v1/checkout/bootstrap");

export const createCustomerAddress = (input: {
  candidate: AddressSearchCandidate;
  label: string;
  recipient: string;
  phone: string;
  instructions: string | null;
}) =>
  commerce<CustomerAddressView>("/v1/addresses", {
    label: input.label,
    recipient: input.recipient,
    phone: input.phone,
    instructions: input.instructions,
    latitude: input.candidate.coordinate.latitude,
    longitude: input.candidate.coordinate.longitude,
    components: input.candidate.components,
    idempotencyKey: crypto.randomUUID(),
  });

export const getFulfillmentOptions = (addressId: string, addressVersion: number, cart: CartView) =>
  commerce<readonly FulfillmentOptionView[]>("/v1/checkout/options", {
    addressId,
    addressVersion,
    cartId: cart.id,
    cartVersion: cart.version,
  });

export const createCheckoutQuote = (
  cart: CartView,
  addressId: string,
  fulfillmentOptionId: string,
) =>
  commerce<CheckoutQuoteView>("/v1/checkout/quote", {
    cartId: cart.id,
    cartVersion: cart.version,
    addressId,
    fulfillmentOptionId,
    idempotencyKey: crypto.randomUUID(),
  });

export const abandonCheckoutQuote = (quote: CheckoutQuoteView) =>
  commerce<AbandonCheckoutResult>("/v1/checkout/abandon", {
    quoteId: quote.quoteId,
    expectedVersion: quote.attemptVersion,
    idempotencyKey: `${quote.quoteId}:abandon`,
  });

export const createCheckoutPayment = (quote: CheckoutQuoteView) =>
  commerce<PaymentActionView>("/v1/checkout/payment", {
    checkoutAttemptId: quote.quoteId,
    expectedQuoteVersion: quote.attemptVersion,
    expectedPriceAcceptanceVersion: quote.priceAcceptanceVersion,
    expectedCurrency: quote.currency,
    expectedMerchandiseSubtotalMinor: quote.merchandiseSubtotalMinor,
    expectedItemDiscountMinor: quote.itemDiscountMinor,
    expectedOrderDiscountMinor: quote.orderDiscountMinor,
    expectedDeliverySubtotalMinor: quote.deliverySubtotalMinor,
    expectedDeliveryFeeMinor: quote.deliveryFeeMinor,
    expectedDeliveryDiscountMinor: quote.deliveryDiscountMinor,
    expectedTaxMinor: quote.taxMinor,
    expectedTotalMinor: quote.totalMinor,
    idempotencyKey: `${quote.quoteId}:payment:qrph`,
  });

export const getCheckoutPaymentCompletion = (paymentIntentId: string) =>
  commerce<CheckoutPaymentCompletionView>(
    `/v1/checkout/payment?paymentIntentId=${encodeURIComponent(paymentIntentId)}`,
  );
