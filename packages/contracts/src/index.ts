import type { CoreServiceBinding } from "./core-service";

export * from "./common";
export * from "./states";
export type * from "./auth";
export type * from "./catalog";
export type * from "./membership";
export type * from "./payments";
export type * from "./checkout";
export type * from "./orders";
export type * from "./operations";

import type { AppErrorCode, AppError, CoreHealthResponse, RequestMeta, RpcResult } from "./common";
import type {
  CustomerAddressStatus,
  DeliveryCycleState,
  ImplementedOrderState,
  OperationsCommandState,
  ReceivingRecordState,
  SubscriptionState,
} from "./states";

export type CoreEntrypoint = {
  health(meta?: RequestMeta): Promise<CoreHealthResponse>;
};

export type HealthService = {
  health(meta?: RequestMeta): Promise<CoreHealthResponse>;
};

export type {
  CoreServiceBinding,
  ImplementedCoreService,
  LegacyOperationsService,
} from "./core-service";

export type AuthRequest = {
  method: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
};

export type AuthResponse = {
  status: number;
  headers: ReadonlyArray<readonly [string, string]>;
  body: string;
};

export type AuthContextRequest = {
  headers: Readonly<Record<string, string>>;
  requestId: string;
};

export type AuthenticatedPrincipal = {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
};

export type Capability =
  | "staff:read"
  | "staff:manage"
  | "rbac:read"
  | "rbac:manage"
  | "location:read"
  | "location:manage"
  | "order:manage"
  | "inventory:manage"
  | "procurement:manage"
  | "fulfillment:manage"
  | "delivery:manage";

export type Scope =
  | { kind: "global" }
  | { kind: "market"; marketId: string }
  | { kind: "location"; locationId: string };

export type ApplicationContext = {
  authenticated: boolean;
  principal: AuthenticatedPrincipal | null;
  capabilities: ReadonlyArray<Capability>;
  scopes: ReadonlyArray<Scope>;
};

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type ServiceabilityFailureReason =
  | "INVALID_COORDINATES"
  | "OUTSIDE_SERVICE_AREA"
  | "OUTSIDE_DELIVERY_ZONE"
  | "NO_ELIGIBLE_LOCATION";

export type ServiceabilityRequest = RequestMeta &
  Coordinate & {
    marketCode?: string;
    addressComponents?: Readonly<Record<string, string>>;
    previousResolution?: {
      serviceAreaCode: string;
      serviceAreaPolygonVersion: number;
      deliveryZoneCode: string | null;
      deliveryZonePolygonVersion: number | null;
    };
  };

export type ServiceabilityMarket = {
  code: string;
  name: string;
  currency: string;
  timezone: string;
};

export type ServiceabilityArea = {
  code: string;
  name: string;
  polygonVersion: number;
};

export type ServiceabilityZone = {
  code: string;
  name: string;
  polygonVersion: number;
};

export type ServiceabilityResult = {
  serviceable: boolean;
  reason: ServiceabilityFailureReason | null;
  coordinate: Coordinate;
  market: ServiceabilityMarket | null;
  serviceArea: ServiceabilityArea | null;
  deliveryZone: ServiceabilityZone | null;
  fulfillmentEligibility: {
    eligible: boolean;
    candidateCount: number;
  };
  resolutionChanged: boolean;
  evaluatedAt: string;
};

export type CatalogVariant = {
  id: string;
  code: string;
  name: string;
  unit: string;
  consumptionBaseQuantity: number;
  priceMinor: number | null;
  currency: string | null;
  priceVersion: number | null;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: { code: string; name: string; slug: string };
  available: boolean;
  sourcingMode: "STOCKED" | "PLANNED_PROCUREMENT" | "HYBRID";
  variants: ReadonlyArray<CatalogVariant>;
};

export type CatalogSearchPage = {
  items: ReadonlyArray<CatalogProduct>;
  nextCursor: string | null;
};

export type CategoryNavigationView = {
  categories: ReadonlyArray<{ code: string; name: string; slug: string }>;
};

export type MarketplaceProductView = {
  product: CatalogProduct;
  deliveryContext: { locationAware: boolean };
};

export type CatalogSearchRequest = RequestMeta & {
  query?: string;
  limit?: number;
  locationId?: string;
};

export type CatalogProductRequest = RequestMeta & {
  slug: string;
  locationId?: string;
};

export type AuthenticatedRequest = RequestMeta & {
  headers: Readonly<Record<string, string>>;
};
export type CreateCustomerAddressRequest = AuthenticatedRequest & {
  label: string;
  recipient: string;
  phone: string;
  addressJson: string;
  latitude: number;
  longitude: number;
  notes?: string | null;
};
export type UpdateCustomerAddressRequest = AuthenticatedRequest & {
  addressId: string;
  expectedVersion: number;
  label?: string;
  recipient?: string;
  phone?: string;
  addressJson?: string;
  latitude?: number;
  longitude?: number;
  notes?: string | null;
};
export type CustomerAddressView = {
  id: string;
  label: string;
  recipient: string;
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
export type SubscriptionEligibilityRequest = AuthenticatedRequest;
export type SubscriptionEligibility = {
  eligible: boolean;
  state: SubscriptionState | null;
  trialEndsAt: string | null;
};
export type DeliveryCycleRequest = RequestMeta & { marketCode?: string };
export type DeliveryCycleView = {
  id: string;
  name: string;
  cutoffAt: string;
  deliveryDate: string;
  status: DeliveryCycleState;
  capacityRemaining: number;
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
  deliveryCycleId: string;
  idempotencyKey: string;
};
export type CheckoutQuoteView = {
  quoteId: string;
  attemptVersion: number;
  expiresAt: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  lines: ReadonlyArray<Record<string, unknown>>;
};
export type CheckoutQuoteRefreshRequest = AuthenticatedRequest & {
  quoteId: string;
  expectedVersion: number;
};
export type StartTrialRequest = AuthenticatedRequest & { offerCode?: string };
export type CartView = {
  id: string;
  version: number;
  items: ReadonlyArray<{
    skuId: string;
    quantity: number;
    name: string;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  totalMinor: number;
  currency: string;
};
export type SetCartItemRequest = AuthenticatedRequest & {
  skuId: string;
  quantity: number;
  locationId?: string;
};
export type CustomerOrderView = {
  id: string;
  status: ImplementedOrderState;
  deliveryDate: string;
  totalMinor: number;
  currency: string;
  itemCount: number;
};
export type AdminOrderCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: "CANCEL" | "REFUND";
  reason: string;
  idempotencyKey: string;
  expectedVersion: number;
};
export type AdminCommandResult = { id: string; status: OperationsCommandState };
export type InventoryAdjustmentRequest = AuthenticatedRequest & {
  locationId: string;
  inventoryPoolId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
  expectedVersion: number;
};
export type InventoryAdjustmentResult = {
  locationId: string;
  inventoryPoolId: string;
  onHandBase: number;
  reservedBase: number;
  version: number;
  ledgerEntryId: string;
};
export type ProcurementCommandRequest = AuthenticatedRequest & {
  deliveryCycleId: string;
  locationId: string;
  inventoryPoolId: string;
  quantity: number;
  idempotencyKey: string;
  expectedVersion: number;
};
export type ReceivingCommandRequest = AuthenticatedRequest & {
  requirementId: string;
  acceptedQuantity: number;
  rejectedQuantity: number;
  reason?: string;
  idempotencyKey: string;
  expectedVersion: number;
};
export type ReceivingCommandResult = {
  receivingRecordId: string;
  status: ReceivingRecordState;
  acceptedBase: number;
  rejectedBase: number;
  remainingBase: number;
  version: number;
};
export type FulfillmentCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: "START" | "PACK" | "SHORTAGE";
  idempotencyKey: string;
  expectedVersion: number;
};
export type DeliveryCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: "DISPATCH" | "DELIVER" | "FAIL";
  idempotencyKey: string;
  expectedVersion: number;
};
