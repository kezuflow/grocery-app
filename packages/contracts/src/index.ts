export const CONTRACT_VERSION = "2026-08-25.mvp-commerce" as const;

export type RequestMeta = {
  requestId: string;
  idempotencyKey?: string;
  locale?: string;
  timezone?: string;
};

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STALE_VERSION"
  | "SUBSCRIPTION_REQUIRED"
  | "ADDRESS_NOT_SERVICEABLE"
  | "CYCLE_CLOSED"
  | "CYCLE_FULL"
  | "INSUFFICIENT_STOCK"
  | "CAPACITY_UNAVAILABLE"
  | "PRICE_CHANGED"
  | "ITEM_UNAVAILABLE"
  | "PROMOTION_INELIGIBLE"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "FINANCIAL_OPERATION_REQUIRES_REVIEW"
  | "CONFIGURATION_ERROR"
  | "ILLEGAL_TRANSITION"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

export type AppError = {
  code: AppErrorCode;
  message: string;
  requestId: string;
  details?: Readonly<Record<string, string>>;
};

export type RpcResult<T> =
  | { ok: true; value: T; requestId: string }
  | { ok: false; error: AppError };

export type CoreHealthResponse = {
  service: "core";
  status: "ok";
  contractVersion: typeof CONTRACT_VERSION;
  environment: string;
  databaseBindingConfigured: boolean;
  timestamp: string;
};

export type CoreEntrypoint = {
  health(meta?: RequestMeta): Promise<CoreHealthResponse>;
};

export type CoreServiceBinding = {
  health(meta?: RequestMeta): Promise<CoreHealthResponse>;
  auth(request: AuthRequest): Promise<AuthResponse>;
  getApplicationContext(request: AuthContextRequest): Promise<RpcResult<ApplicationContext>>;
  resolveServiceability(request: ServiceabilityRequest): Promise<RpcResult<ServiceabilityResult>>;
  searchCatalog(request: CatalogSearchRequest): Promise<RpcResult<CatalogSearchPage>>;
  getCatalogProduct(
    request: CatalogProductRequest,
  ): Promise<RpcResult<MarketplaceProductView | null>>;
  listCategories(request: RequestMeta): Promise<RpcResult<CategoryNavigationView>>;
  createCustomerAddress(
    request: CreateCustomerAddressRequest,
  ): Promise<RpcResult<CustomerAddressView>>;
  listCustomerAddresses(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CustomerAddressView>>>;
  updateCustomerAddress(
    request: UpdateCustomerAddressRequest,
  ): Promise<RpcResult<CustomerAddressView>>;
  getSubscriptionEligibility(
    request: SubscriptionEligibilityRequest,
  ): Promise<RpcResult<SubscriptionEligibility>>;
  listDeliveryCycles(
    request: DeliveryCycleRequest,
  ): Promise<RpcResult<ReadonlyArray<DeliveryCycleView>>>;
  evaluateCheckout(
    request: CheckoutEligibilityRequest,
  ): Promise<RpcResult<CheckoutEligibilityView>>;
  commitMockOrder(request: CommitMockOrderRequest): Promise<RpcResult<CommittedOrderView>>;
  startTrial(request: StartTrialRequest): Promise<RpcResult<SubscriptionEligibility>>;
  getCart(request: AuthenticatedRequest): Promise<RpcResult<CartView>>;
  setCartItem(request: SetCartItemRequest): Promise<RpcResult<CartView>>;
  listCustomerOrders(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CustomerOrderView>>>;
  advanceOrder(request: AdminOrderCommandRequest): Promise<RpcResult<AdminCommandResult>>;
  adjustInventory(
    request: InventoryAdjustmentRequest,
  ): Promise<RpcResult<InventoryAdjustmentResult>>;
  createProcurementRequirement(
    request: ProcurementCommandRequest,
  ): Promise<RpcResult<AdminCommandResult>>;
  receiveProcurement(request: ReceivingCommandRequest): Promise<RpcResult<ReceivingCommandResult>>;
  advanceFulfillment(request: FulfillmentCommandRequest): Promise<RpcResult<AdminCommandResult>>;
  advanceDelivery(request: DeliveryCommandRequest): Promise<RpcResult<AdminCommandResult>>;
};

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
  status: string;
  version: number;
};
export type SubscriptionEligibilityRequest = AuthenticatedRequest;
export type SubscriptionEligibility = {
  eligible: boolean;
  status: string | null;
  trialEndsAt: string | null;
};
export type DeliveryCycleRequest = RequestMeta & { marketCode?: string };
export type DeliveryCycleView = {
  id: string;
  name: string;
  cutoffAt: string;
  deliveryDate: string;
  status: string;
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
export type CommitMockOrderRequest = CheckoutEligibilityRequest & { idempotencyKey: string };
export type CommittedOrderView = {
  orderId: string;
  paymentStatus: "SUCCEEDED";
  orderStatus: "COMMITTED";
  totalMinor: number;
  currency: string;
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
  status: string;
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
  expectedVersion?: number;
};
export type AdminCommandResult = { id: string; status: string };
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
  expectedVersion?: number;
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
  status: string;
  acceptedBase: number;
  rejectedBase: number;
  remainingBase: number;
  version: number;
};
export type FulfillmentCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: "START" | "PACK" | "SHORTAGE";
  idempotencyKey: string;
  expectedVersion?: number;
};
export type DeliveryCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: "DISPATCH" | "DELIVER" | "FAIL";
  idempotencyKey: string;
  expectedVersion?: number;
};
