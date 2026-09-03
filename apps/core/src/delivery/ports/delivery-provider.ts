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
  name: string;
  description: string;
  quantity: number;
  heightCentimeters: number;
  widthCentimeters: number;
  depthCentimeters: number;
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
  serviceType: string;
  amountMinor: number;
  currency: string;
  estimatedPickupAt: string | null;
  estimatedDropoffAt: string | null;
  distanceMeters: number | null;
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
  merchantOrderId: string;
  status: ProviderDeliveryStatus;
  trackingUrl: string | null;
  pickupPin: string | null;
  quote: DeliveryQuote | null;
}>;

/** Provider-specific vocabulary stops at this boundary. */
export interface DeliveryProvider {
  readonly code: string;
  quote(
    request: DeliveryProviderRequest,
  ): Promise<DeliveryProviderResult<readonly DeliveryQuote[]>>;
  create(request: CreateDeliveryRequest): Promise<DeliveryProviderResult<ProviderDelivery>>;
  get(providerDeliveryId: string): Promise<DeliveryProviderResult<ProviderDelivery | null>>;
  cancel(providerDeliveryId: string): Promise<DeliveryProviderResult<null>>;
}
