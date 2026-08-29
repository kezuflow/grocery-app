import type { CoreServiceBinding } from "./core-service";

export * from "./common";
export * from "./admin-foundation";
export * from "./admin-staff-access";
export * from "./admin-customers";
export * from "./admin-promotions";
export * from "./admin-catalog";
export * from "./admin-finance";
export * from "./admin-operations";
export * from "./admin-analytics";
export * from "./states";
export type * from "./geography";
export type * from "./auth";
export type * from "./catalog";
export type * from "./membership";
export type * from "./payments";
export type * from "./checkout";
export type * from "./orders";
export type * from "./operations";
export type * from "./delivery-maps";

import type { AppErrorCode, AppError, CoreHealthResponse, RequestMeta, RpcResult } from "./common";
import type { Capability } from "./admin-foundation";
import type {
  AddressComponents,
  AddressComponentsSource,
  Coordinate,
  CoordinateConfirmationSource,
  DeliveryInstructions,
} from "./geography";
import type {
  CustomerAddressStatus,
  DeliveryAction,
  DeliveryCycleState,
  FulfillmentAction,
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

export type { CoreServiceBinding, ImplementedCoreService } from "./core-service";

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

/**
 * Canonical admin capability. Derived from the closed dot-form vocabulary in
 * `admin-foundation.ts`; historical colon-form rows remain compatibility data.
 */
export type { Capability } from "./admin-foundation";

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

/**
 * Customer-facing controlled sell-unit codes for catalog variants.
 * `PACK`/`BUNCH` merchandising labels are never universal units, so the
 * public surface is limited to `G`, `KG`, and `PC`.
 */
export type CatalogSellUnitCode = "G" | "KG" | "PC";

export type CatalogVariant = {
  id: string;
  code: string;
  /** Fixed customer-facing variant display name, e.g. `500 g` or `1 pack`. */
  name: string;
  /** Optional merchandising label such as `Pack` or `Bunch`. */
  merchandisingLabel: string | null;
  /** Sellable quantity expressed in the controlled sell unit. */
  sellQuantity: number;
  sellUnitCode: CatalogSellUnitCode;
  /** Customer-facing sell-unit symbol derived from the stored unit row. */
  unit: string;
  /** Exact integer base-unit (GRAM/PIECE) consumption per sellable unit. */
  consumptionBaseQuantity: number;
  /**
   * Approximate customer contents copy for assembled packs/bunches. Exact
   * recipes and staff packing instructions stay server-side.
   */
  contentsNote: string | null;
  priceMinor: number | null;
  currency: string | null;
  priceVersion: number | null;
};

export type CatalogMedia = {
  /** Public asset path served by Web, e.g. `/produce/<asset-key>.webp`. */
  src: string;
  alt: string;
};

export type CatalogDetail = {
  label: string;
  value: string;
  sortOrder: number;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: { code: string; name: string; slug: string };
  /** Core-resolved media metadata; null renders the accessible placeholder. */
  media: CatalogMedia | null;
  /** Ordered customer-facing product details. */
  details: ReadonlyArray<CatalogDetail>;
  available: boolean;
  variants: ReadonlyArray<CatalogVariant>;
};

export type CatalogSearchPage = {
  items: ReadonlyArray<CatalogProduct>;
  nextCursor: string | null;
};

export type CategoryNavigationView = {
  categories: ReadonlyArray<{
    code: string;
    name: string;
    slug: string;
    /** Core-resolved public SVG path; null renders the Web fallback icon. */
    iconSrc: string | null;
  }>;
};

export type MarketplaceHomeRail = {
  code: string;
  title: string;
  categorySlug: string;
  items: ReadonlyArray<CatalogProduct>;
};

/** Bounded home discovery view; rails never materialize the full catalog. */
export type MarketplaceHomeView = {
  categories: CategoryNavigationView["categories"];
  rails: ReadonlyArray<MarketplaceHomeRail>;
};

export type MarketplaceHomeRequest = RequestMeta & {
  locationId?: string;
  itemsPerRail?: number;
};

export type MarketplaceProductView = {
  product: CatalogProduct;
  deliveryContext: { locationAware: boolean };
};

export type CatalogSearchRequest = RequestMeta & {
  query?: string;
  categorySlug?: string;
  cursor?: string;
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
        /** Historical compatibility input; new callers omit it. */
        addressJson?: string;
      }
    | {
        /** Historical compatibility input for callers not yet migrated to structured fields. */
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
  /** Historical compatibility input; new callers use structured components. */
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
  merchandiseSubtotalMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  deliverySubtotalMinor: number;
  deliveryDiscountMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  /** Compatibility projection; use merchandiseSubtotalMinor. */
  subtotalMinor: number;
  /** Compatibility projection; equals itemDiscountMinor + orderDiscountMinor. */
  discountMinor: number;
  /** Compatibility projection; use deliverySubtotalMinor. */
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
  action: FulfillmentAction;
  idempotencyKey: string;
  expectedVersion: number;
};
export type DeliveryCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: DeliveryAction;
  idempotencyKey: string;
  expectedVersion: number;
};
