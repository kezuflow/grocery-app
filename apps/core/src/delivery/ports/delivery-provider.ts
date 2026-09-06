import type { AddressComponents, Coordinate, DeliveryInstructions } from "@freshmarkets/contracts";

export type DeliveryContact = Readonly<{
  name: string;
  phoneE164: string | null;
  email: string | null;
  smsEnabled: boolean;
}>;

export type DeliveryProviderAddress = Readonly<{
  formattedAddress: string;
  coordinate: Coordinate;
  components: AddressComponents;
  instructions: DeliveryInstructions;
}>;

export type DeliveryPackage = Readonly<{
  /** FreshMarkets packing class: one BAG below 10 kg, otherwise one BOX. */
  kind: "BAG" | "BOX";
  name: string;
  description: string;
  quantity: number;
  /** Optional because Lalamove PH does not receive parcel dimensions. */
  heightCentimeters?: number;
  widthCentimeters?: number;
  depthCentimeters?: number;
  weightGrams: number;
  priceMinor: number | null;
}>;

export type DeliverySchedule = Readonly<{
  pickupFrom: string;
  pickupTo: string;
}>;

export type DeliveryProviderRequest = Readonly<{
  serviceType: string;
  currencyCode: string;
  currencyExponent: number;
  packages: readonly DeliveryPackage[];
  sender: DeliveryContact;
  recipient: DeliveryContact;
  origin: DeliveryProviderAddress;
  destination: DeliveryProviderAddress;
  schedule: DeliverySchedule | null;
}>;

export type CreateDeliveryRequest = DeliveryProviderRequest &
  Readonly<{
    merchantOrderId: string;
  }>;

export type DeliveryProviderError = Readonly<{
  code: string;
  retryable: boolean;
  /** Provider-declared backoff for rate limiting, when available. */
  retryAfterMilliseconds?: number;
  /**
   * True when the provider may have accepted a mutating request even though no
   * authoritative response reached Core. Callers must reconcile instead of
   * blindly issuing the mutation again.
   */
  outcomeUnknown: boolean;
}>;

export type DeliveryProviderResult<T> =
  | Readonly<{ ok: true; value: T; providerRequestId?: string }>
  | Readonly<{ ok: false; error: DeliveryProviderError; providerRequestId?: string }>;

export type DeliveryQuote = Readonly<{
  /** Opaque provider evidence; never accepted from a browser as authoritative. */
  providerQuotationId: string | null;
  serviceType: string;
  amountMinor: number;
  currency: string;
  expiresAt: string | null;
  estimatedPickupAt: string | null;
  estimatedDropoffAt: string | null;
  distanceMeters: number | null;
}>;

export type DeliveryProviderCapabilities = Readonly<{
  immediateQuotation: boolean;
  scheduledQuotation: Readonly<{
    supported: boolean;
    maximumAdvanceMilliseconds: number | null;
  }>;
  createDelivery: boolean;
  retrieveDelivery: boolean;
  cancelDelivery: boolean;
  signedStatusWebhooks: boolean;
  requiresPackageDimensions: boolean;
}>;

export type ProviderDeliveryStatus =
  | "ALLOCATING"
  | "PENDING_PICKUP"
  | "PICKING_UP"
  | "PENDING_DROP_OFF"
  | "IN_DELIVERY"
  | "IN_RETURN"
  | "COMPLETED"
  | "CANCELED"
  | "RETURNED"
  | "FAILED"
  | "UNKNOWN";

export type ProviderDelivery = Readonly<{
  providerDeliveryId: string;
  /**
   * Present when the provider echoes FreshMarkets metadata. Some provider GET
   * responses expose only their own order identifier, so reconciliation must
   * retain the merchant reference from the local dispatch record.
   */
  merchantOrderId: string | null;
  status: ProviderDeliveryStatus;
  trackingUrl: string | null;
  pickupPin: string | null;
  quote: DeliveryQuote | null;
}>;

/** Provider-specific vocabulary stops at this boundary. */
export interface DeliveryProvider {
  readonly code: string;
  readonly capabilities: DeliveryProviderCapabilities;
  quote(
    request: DeliveryProviderRequest,
  ): Promise<DeliveryProviderResult<readonly DeliveryQuote[]>>;
  create(request: CreateDeliveryRequest): Promise<DeliveryProviderResult<ProviderDelivery>>;
  get(providerDeliveryId: string): Promise<DeliveryProviderResult<ProviderDelivery | null>>;
  cancel(providerDeliveryId: string): Promise<DeliveryProviderResult<null>>;
}
