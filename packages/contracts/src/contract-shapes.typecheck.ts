import type { CoreServiceBinding, MembershipService, OperationsService } from "./core-service";
import type {
  AbandonCheckoutResult,
  CartView,
  CheckoutQuoteCommandRequest,
  CheckoutQuoteView,
  SetCartItemRequest,
} from "./checkout";
import type {
  AddressComponentsSource,
  AddressSearchCandidate,
  AddressSearchRequest,
  CoordinateConfirmationSource,
  DeliveryInstructions,
  ServiceabilityResult,
} from "./geography";
import type { AuthRequest } from "./auth";
import type { CatalogProduct, CatalogSearchRequest, CatalogVariant } from "./catalog";
import type { MembershipExperienceView } from "./membership";
import type { AdminBootstrapView, AdminOverviewView } from "./admin-overview";
import type { MetricDefinitionView } from "./admin-analytics";
import type { AdminCatalogService, AdminProductMediaContent } from "./admin-catalog";
import type { AdminPaymentDetail } from "./admin-finance";
import type { PaymentIntentCommandRequest } from "./payments";
import type {
  CancelCustomerOrderRequest,
  CustomerOrderDetailView,
  CustomerOrderIssueView,
  OrderCancellationView,
  ProvisionalTransactionSummaryRequest,
  ProvisionalTransactionSummaryView,
  ReorderResultView,
} from "./orders";
import type { RpcResult } from "./common";
import type {
  CustomerAddressView,
  CustomerOrderView,
  CoreHealthResponse,
  ReceivingCommandResult,
  UpdateCustomerAddressRequest,
} from "./index";
import type { OrderState, PaymentState, RefundState, SubscriptionState } from "./states";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Type extends true> = Type;

// These contracts are enforced by the package typecheck, not by runtime Vitest assertions.
export type CancelCustomerOrderSignature = Expect<
  Equal<
    CoreServiceBinding["cancelCustomerOrder"],
    (request: CancelCustomerOrderRequest) => Promise<RpcResult<OrderCancellationView>>
  >
>;

export type ProvisionalTransactionSummarySignature = Expect<
  Equal<
    CoreServiceBinding["getProvisionalTransactionSummary"],
    (
      request: ProvisionalTransactionSummaryRequest,
    ) => Promise<RpcResult<ProvisionalTransactionSummaryView>>
  >
>;

export type AddressSearchSignature = Expect<
  Equal<
    CoreServiceBinding["searchAddressCandidates"],
    (request: AddressSearchRequest) => Promise<RpcResult<ReadonlyArray<AddressSearchCandidate>>>
  >
>;

export type CheckoutFinancialComponents = Expect<
  Equal<
    Pick<
      CheckoutQuoteView,
      | "merchandiseSubtotalMinor"
      | "itemDiscountMinor"
      | "orderDiscountMinor"
      | "deliverySubtotalMinor"
      | "deliveryFeeMinor"
      | "deliveryDiscountMinor"
      | "taxMinor"
      | "totalMinor"
    >,
    {
      merchandiseSubtotalMinor: number;
      itemDiscountMinor: number;
      orderDiscountMinor: number;
      deliverySubtotalMinor: number;
      deliveryFeeMinor: number;
      deliveryDiscountMinor: number;
      taxMinor: number;
      totalMinor: number;
    }
  >
>;

export type SubscriptionTrialingState = Expect<
  Equal<Extract<SubscriptionState, "TRIALING">, "TRIALING">
>;
export type PaymentSucceededState = Expect<Equal<Extract<PaymentState, "SUCCEEDED">, "SUCCEEDED">>;
export type RefundSucceededState = Expect<Equal<Extract<RefundState, "SUCCEEDED">, "SUCCEEDED">>;
export type OrderCommittedState = Expect<Equal<Extract<OrderState, "COMMITTED">, "COMMITTED">>;

export type CustomerOrderFixture = Expect<
  {
    id: "order-1";
    orderNumber: "FM-2026-ORDER1";
    status: "COMMITTED";
    fulfillmentMode: "SCHEDULED";
    deliveryDate: "2026-09-01T00:00:00.000Z";
    promisedAt: null;
    committedAt: "2026-08-30T00:00:00.000Z";
    totalMinor: 19900;
    currency: "PHP";
    itemCount: 2;
  } extends CustomerOrderView
    ? true
    : false
>;

export type ReceivingCommandFixture = Expect<
  {
    receivingRecordId: "rec-1";
    status: "IN_PROGRESS";
    acceptedBase: 4;
    rejectedBase: 0;
    remainingBase: 6;
    version: 2;
  } extends ReceivingCommandResult
    ? true
    : false
>;

// Shape-only guarantees belong to tsc; constructed DTOs cannot validate themselves at runtime.
export type AuthTransportFields = Expect<
  Equal<
    Pick<AuthRequest, "method" | "url" | "headers">,
    {
      method: string;
      url: string;
      headers: Readonly<Record<string, string>>;
    }
  >
>;
export type CartCommandIdentity = Expect<
  Equal<
    Pick<SetCartItemRequest, "cartId" | "expectedVersion" | "idempotencyKey">,
    {
      cartId: string;
      expectedVersion: number;
      idempotencyKey: string;
    }
  >
>;
export type CartUnavailablePrice = Expect<
  Equal<CartView["items"][number]["unitPriceMinor"], number | null>
>;
export type CatalogUnitAndPrice = Expect<
  Equal<
    Pick<
      CatalogVariant,
      "sellUnitCode" | "consumptionBaseQuantity" | "priceMinor" | "priceVersion"
    >,
    {
      sellUnitCode: "G" | "KG" | "PC";
      consumptionBaseQuantity: number;
      priceMinor: number | null;
      priceVersion: number | null;
    }
  >
>;
export type CatalogPublicFields = Expect<
  Equal<Extract<keyof CatalogProduct, "packingInstruction" | "sourcingMode">, never>
>;
export type CatalogSearchFilters = Expect<
  Equal<
    Pick<CatalogSearchRequest, "categorySlug" | "cursor" | "limit" | "locationId">,
    {
      categorySlug?: string;
      cursor?: string;
      limit?: number;
      locationId?: string;
    }
  >
>;
export type PaymentAcceptanceFields = Expect<
  Equal<
    Pick<
      PaymentIntentCommandRequest,
      "expectedQuoteVersion" | "expectedPriceAcceptanceVersion" | "expectedTotalMinor"
    >,
    {
      expectedQuoteVersion: number;
      expectedPriceAcceptanceVersion: number;
      expectedTotalMinor: number;
    }
  >
>;
export type AbandonmentIsNotAnOrder = Expect<
  Equal<Extract<keyof AbandonCheckoutResult, "orderStatus">, never>
>;
export type MembershipCustomerBoundary = Expect<
  Equal<Extract<keyof MembershipExperienceView, "provider">, never>
>;
export type MembershipActions = Expect<
  Equal<
    MembershipExperienceView["actions"]["cancelImmediately"],
    {
      available: boolean;
      disabledReason: string | null;
    }
  >
>;
export type AdminOverviewAuthority = Expect<
  Equal<
    Pick<AdminOverviewView, "selectedScope" | "timezone" | "deniedSections">,
    {
      selectedScope: AdminOverviewView["selectedScope"];
      timezone: string;
      deniedSections: ReadonlyArray<string>;
    }
  >
>;
export type AdminBootstrapSelection = Expect<
  Equal<
    AdminBootstrapView["selection"]["source"],
    "REQUESTED" | "SINGLE_ASSIGNMENT" | "SELECTION_REQUIRED"
  >
>;
export type MembershipProviderReferenceExcluded = Expect<
  Equal<Extract<keyof Parameters<MembershipService["startTrial"]>[0], "paymentMethodRef">, never>
>;
export type OperationsActionsClosed = Expect<
  Equal<
    {
      [K in keyof OperationsService]: OperationsService[K] extends (input: infer Input) => unknown
        ? "action" extends keyof Input
          ? string extends Input["action"]
            ? true
            : false
          : false
        : false;
    }[keyof OperationsService],
    false
  >
>;
export type NoMockCommitmentCommand = Expect<
  Equal<Extract<keyof CoreServiceBinding, "commitMockOrder">, never>
>;
export type CheckoutSelectsOpaqueOption = Expect<
  Equal<
    Pick<CheckoutQuoteCommandRequest, "fulfillmentOptionId">,
    {
      fulfillmentOptionId: string;
    }
  >
>;
export type CheckoutDoesNotSelectLocation = Expect<
  Equal<Extract<keyof CheckoutQuoteCommandRequest, "locationId">, never>
>;
export type GeographyProvenance = Expect<
  Equal<CoordinateConfirmationSource, "GEOCODER" | "USER_PIN" | "DEVICE_LOCATION">
>;
export type AddressComponentProvenance = Expect<
  Equal<AddressComponentsSource, "TEMPORARY_GEOCODER" | "FIRST_PARTY" | "SAVED_ADDRESS">
>;
export type StructuredInstructions = Expect<
  Equal<DeliveryInstructions, { deliveryInstructions: string | null }>
>;
export type ServiceabilityDoesNotExposeGeometry = Expect<
  Equal<Extract<keyof ServiceabilityResult, "polygonGeoJson" | "databaseRow">, never>
>;
export type AddressUpdateProvenance = Expect<
  Equal<
    Pick<UpdateCustomerAddressRequest, "componentsSource" | "confirmationSource" | "instructions">,
    {
      componentsSource?: AddressComponentsSource;
      confirmationSource?: CoordinateConfirmationSource;
      instructions?: DeliveryInstructions;
    }
  >
>;
export type CustomerAddressConfirmation = Expect<
  Equal<
    Pick<CustomerAddressView, "confirmationSource" | "confirmedAt" | "instructions">,
    {
      confirmationSource: CoordinateConfirmationSource | null;
      confirmedAt: string | null;
      instructions: DeliveryInstructions;
    }
  >
>;
export type CustomerOrderHasNoInternalAuthority = Expect<
  Equal<
    Extract<
      keyof CustomerOrderDetailView,
      "provider" | "audit" | "staffIdentity" | "inventory" | "procurement" | "locationId"
    >,
    never
  >
>;
export type CustomerCancellationHasNoActorOverride = Expect<
  Equal<Extract<keyof CancelCustomerOrderRequest, "actor" | "cause">, never>
>;
export type CustomerRefundsHaveNoProvider = Expect<
  Equal<Extract<keyof OrderCancellationView["refunds"][number], "provider">, never>
>;
export type ProvisionalSummaryHasNoTaxIdentity = Expect<
  Equal<Extract<keyof ProvisionalTransactionSummaryView, "sellerTin" | "officialSerial">, never>
>;
export type ReorderUsesCurrentCommerce = Expect<
  Equal<Extract<keyof ReorderResultView, "historicalPriceMinor" | "cycleId" | "addressId">, never>
>;
export type CustomerIssueHasNoAdminAction = Expect<
  Equal<
    Extract<keyof CustomerOrderIssueView, "assignedStaffId" | "refundAction" | "adminActions">,
    never
  >
>;
export type AnalyticsDefinitionHasNoStorageOrFormula = Expect<
  Equal<Extract<keyof MetricDefinitionView, "database" | "formulaJson">, never>
>;
export type CatalogHasNoDeleteCommand = Expect<
  Equal<Extract<keyof AdminCatalogService, "deleteAdminCategory">, never>
>;
export type ProductMediaHidesStorageKey = Expect<
  Equal<Extract<keyof AdminProductMediaContent, "objectKey">, never>
>;
export type AdminPaymentHidesProviderPayload = Expect<
  Equal<Extract<keyof AdminPaymentDetail, "providerReference" | "payloadHash">, never>
>;
export type CoreHealthHidesDatabase = Expect<
  Equal<Extract<keyof CoreHealthResponse, "databaseRow">, never>
>;
