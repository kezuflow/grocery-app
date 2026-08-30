import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./auth";
import type {
  AddressComponents,
  AddressComponentsSource,
  CoordinateConfirmationSource,
  DeliveryInstructions,
  ServiceabilityFailureReason,
} from "./geography";
import type { CustomerAddressStatus } from "./states";

type CustomerAddressCreateBase = AuthenticatedRequest & {
  label: string;
  recipient: string;
  phone: string;
  latitude: number;
  longitude: number;
  notes?: string | null;
};

export type CreateCustomerAddressRequest = CustomerAddressCreateBase &
  (
    | {
        components: AddressComponents;
        componentsSource: Exclude<AddressComponentsSource, "SAVED_ADDRESS">;
        confirmationSource: CoordinateConfirmationSource;
        instructions: DeliveryInstructions;
        addressJson?: string;
      }
    | {
        addressJson: string;
        components?: never;
        componentsSource?: never;
        confirmationSource?: never;
        instructions?: never;
      }
  );

export type UpdateCustomerAddressRequest = AuthenticatedRequest & {
  addressId: string;
  expectedVersion: number;
  label?: string;
  recipient?: string;
  phone?: string;
  components?: AddressComponents;
  componentsSource?: AddressComponentsSource;
  confirmationSource?: CoordinateConfirmationSource;
  instructions?: DeliveryInstructions;
  addressJson?: string;
  latitude?: number;
  longitude?: number;
  notes?: string | null;
};

export type CustomerAddressView = {
  id: string;
  label: string;
  recipient: string;
  phone: string;
  components: AddressComponents;
  confirmationSource: CoordinateConfirmationSource | null;
  confirmedAt: string | null;
  instructions: DeliveryInstructions;
  latitude: number;
  longitude: number;
  serviceable: boolean | null;
  serviceabilityReason: ServiceabilityFailureReason | null;
  serviceAreaCode: string | null;
  deliveryZoneCode: string | null;
  resolutionVersion: number | null;
  status: CustomerAddressStatus;
  version: number;
};

export type CheckoutEligibilityRequest = AuthenticatedRequest & {
  addressId: string;
  cycleId: string;
  cartId: string;
};

export type CheckoutEligibilityView = {
  eligible: boolean;
  failures: ReadonlyArray<string>;
  totalMinor: number;
  currency: string;
};

export type CheckoutQuoteCommandRequest = AuthenticatedRequest & {
  cartId: string;
  cartVersion: number;
  addressId: string;
  /** Null selects Instant fulfillment; a cycle id selects Scheduled. */
  deliveryCycleId: string | null;
  promotionCodes?: readonly string[];
  idempotencyKey: string;
};

export type PromotionCodeFeedback = {
  code: string;
  status: "APPLIED" | "INVALID" | "EXPIRED" | "INELIGIBLE" | "DUPLICATE" | "NOT_SELECTED";
  message: string;
};

export type CheckoutPromotionApplicationView = {
  promotionId: string;
  code: string;
  name: string;
  component: "MERCHANDISE" | "DELIVERY";
  benefitType:
    | "ORDER_FIXED_DISCOUNT"
    | "ORDER_PERCENT_DISCOUNT"
    | "DELIVERY_FEE_WAIVER"
    | "DELIVERY_FEE_DISCOUNT";
  amountMinor: number;
  automatic: boolean;
};

export type CheckoutQuoteView = {
  quoteId: string;
  attemptVersion: number;
  priceAcceptanceVersion: number;
  expiresAt: string;
  currency: string;
  merchandiseSubtotalMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  deliverySubtotalMinor: number;
  deliveryDiscountMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  lines: ReadonlyArray<Record<string, unknown>>;
  requestedPromotionCodes: readonly string[];
  promotionFeedback: readonly PromotionCodeFeedback[];
  promotionApplications: readonly CheckoutPromotionApplicationView[];
};

export type CheckoutQuoteRefreshRequest = AuthenticatedRequest & {
  quoteId: string;
  expectedVersion: number;
};

export type CartView = {
  id: string;
  version: number;
  items: ReadonlyArray<{
    skuId: string;
    quantity: number;
    name: string;
    availability: "AVAILABLE" | "UNAVAILABLE" | "PRICE_UNAVAILABLE";
    unitPriceMinor: number | null;
    lineTotalMinor: number | null;
  }>;
  totalMinor: number;
  currency: string;
  checkoutBlocked: boolean;
  blockingReasons: ReadonlyArray<"ITEM_UNAVAILABLE" | "PRICE_UNAVAILABLE">;
};

export type SetCartItemRequest = AuthenticatedRequest & {
  cartId: string;
  skuId: string;
  quantity: number;
  expectedVersion: number;
  idempotencyKey: string;
};

/**
 * Canonical checkout target port. Commitment lives behind
 * `createAttempt`/`createPayment`/`recoverCommitment`; the sandbox-only
 * The retired sandbox commitment path has no representation here.
 */
export type CheckoutService = {
  evaluateCheckout(
    request: CheckoutEligibilityRequest,
  ): Promise<RpcResult<CheckoutEligibilityView>>;
  getCart(request: AuthenticatedRequest): Promise<RpcResult<CartView>>;
  setCartItem(request: SetCartItemRequest): Promise<RpcResult<CartView>>;
  createCustomerAddress(
    request: CreateCustomerAddressRequest,
  ): Promise<RpcResult<CustomerAddressView>>;
  listCustomerAddresses(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CustomerAddressView>>>;
  updateCustomerAddress(
    request: UpdateCustomerAddressRequest,
  ): Promise<RpcResult<CustomerAddressView>>;
};
