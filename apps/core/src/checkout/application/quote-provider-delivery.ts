import type { AddressComponents, DeliveryInstructions } from "@freshmarkets/contracts";
import { fixedDeliveryPackage } from "../../fulfillment/domain/delivery-package";
import type {
  DeliveryProvider,
  DeliveryProviderAddress,
  DeliveryQuote,
  DeliveryProviderRequest,
} from "../../delivery/ports/delivery-provider";
import { requestHash } from "../../idempotency";

type JsonObject = Record<string, unknown>;

export type ProviderDeliveryFeeSnapshot = Readonly<{
  source: "EXTERNAL_PROVIDER";
  providerCode: string;
  providerQuotationId: string;
  providerRequestId: string;
  serviceType: string;
  quotedAt: string;
  expiresAt: string;
  scheduleAt: string | null;
  currency: string;
  amountMinor: number;
  distanceMeters: number | null;
  /** Exact provider-relevant route/request identity; cart contents are intentionally excluded. */
  routeFingerprint?: string;
}>;

export type CheckoutDeliveryQuote = Readonly<{
  feeMinor: number;
  snapshot: ProviderDeliveryFeeSnapshot;
}>;

export type ProviderCheckoutAddress = Readonly<{
  recipient: string;
  phone: string;
  address_json: string;
  address_components_json?: string | null;
  delivery_instructions_json?: string | null;
  barangay?: string | null;
  city?: string | null;
  postal_code?: string | null;
  latitude: number;
  longitude: number;
}>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function parseObject(value: string | null | undefined): JsonObject | null {
  if (!value) return null;
  try {
    return object(JSON.parse(value));
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function field(source: JsonObject | null, ...names: string[]): string | null {
  for (const name of names) {
    const value = text(source?.[name]);
    if (value) return value;
  }
  return null;
}

function destination(address: ProviderCheckoutAddress): DeliveryProviderAddress | null {
  const structured = parseObject(address.address_components_json);
  const legacy = parseObject(address.address_json);
  const source = structured ?? legacy;
  const components: AddressComponents = {
    addressLine1: field(source, "addressLine1", "line1", "street") ?? "Delivery address",
    addressLine2: field(source, "addressLine2", "line2"),
    barangay: field(source, "barangay") ?? address.barangay ?? null,
    city: field(source, "city") ?? address.city ?? "Cebu City",
    region: field(source, "region"),
    postalCode: field(source, "postalCode") ?? address.postal_code ?? null,
    countryCode: (field(source, "countryCode") ?? "PH").toUpperCase(),
  };
  const instructionsObject = parseObject(address.delivery_instructions_json);
  const instructions: DeliveryInstructions = {
    deliveryInstructions:
      field(instructionsObject, "deliveryInstructions") ??
      ([
        field(instructionsObject, "buildingUnit"),
        field(instructionsObject, "landmark"),
        field(instructionsObject, "gateGuard"),
        field(instructionsObject, "deliveryNote"),
        field(instructionsObject, "recipientInstruction"),
      ]
        .filter((item): item is string => Boolean(item))
        .filter((item, index, all) => all.indexOf(item) === index)
        .join("\n") ||
        null),
  };
  const formattedAddress =
    field(source, "formattedAddress") ??
    [
      components.addressLine1,
      components.addressLine2,
      components.barangay,
      components.city,
      components.region,
      components.postalCode,
      components.countryCode,
    ]
      .filter(Boolean)
      .join(", ");
  return formattedAddress
    ? {
        formattedAddress,
        coordinate: { latitude: address.latitude, longitude: address.longitude },
        components,
        instructions,
      }
    : null;
}

function chooseQuote(
  quotes: readonly DeliveryQuote[],
  serviceType: string,
  currency: string,
  now: number,
): DeliveryQuote | null {
  const matching = quotes.filter(
    (quote) => quote.serviceType === serviceType && quote.currency === currency,
  );
  if (matching.length !== 1) return null;
  const quote = matching[0]!;
  const expiresAt = quote.expiresAt ? Date.parse(quote.expiresAt) : Number.NaN;
  return quote.providerQuotationId && Number.isFinite(expiresAt) && expiresAt > now ? quote : null;
}

const MINIMUM_REUSABLE_QUOTE_LIFETIME_MS = 30_000;

function reusableSnapshot(
  raw: string,
  input: Readonly<{
    routeFingerprint: string;
    providerCode: string;
    serviceType: string;
    currency: string;
    scheduleAt: string | null;
    now: number;
  }>,
): ProviderDeliveryFeeSnapshot | null {
  const parsed = parseObject(raw);
  if (!parsed) return null;
  const expiresAt = text(parsed.expiresAt);
  const quotedAt = text(parsed.quotedAt);
  const amountMinor = parsed.amountMinor;
  const distanceMeters = parsed.distanceMeters;
  if (
    parsed.source !== "EXTERNAL_PROVIDER" ||
    parsed.routeFingerprint !== input.routeFingerprint ||
    parsed.providerCode !== input.providerCode ||
    parsed.serviceType !== input.serviceType ||
    parsed.currency !== input.currency ||
    (parsed.scheduleAt ?? null) !== input.scheduleAt ||
    !text(parsed.providerQuotationId) ||
    !text(parsed.providerRequestId) ||
    !quotedAt ||
    !expiresAt ||
    !Number.isFinite(Date.parse(quotedAt)) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    !Number.isInteger(amountMinor) ||
    (amountMinor as number) < 0 ||
    (distanceMeters !== null &&
      distanceMeters !== undefined &&
      (!Number.isFinite(distanceMeters) || (distanceMeters as number) < 0)) ||
    Date.parse(expiresAt) <= input.now + MINIMUM_REUSABLE_QUOTE_LIFETIME_MS
  )
    return null;
  return parsed as ProviderDeliveryFeeSnapshot;
}

async function findReusableQuote(
  database: D1Database,
  input: Readonly<{
    customerId: string;
    cartId: string;
    addressId: string;
    routeFingerprint: string;
    providerCode: string;
    serviceType: string;
    currency: string;
    scheduleAt: string | null;
    now: number;
  }>,
): Promise<CheckoutDeliveryQuote | null> {
  const candidates = await database
    .prepare(
      `SELECT delivery_fee_snapshot_json
       FROM checkout_quote
       WHERE customer_id=? AND cart_id=? AND address_id=?
         AND delivery_fee_snapshot_json IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .bind(input.customerId, input.cartId, input.addressId)
    .all<{ delivery_fee_snapshot_json: string }>();
  for (const candidate of candidates.results) {
    const snapshot = reusableSnapshot(candidate.delivery_fee_snapshot_json, input);
    if (snapshot) return { feeMinor: snapshot.amountMinor, snapshot };
  }
  return null;
}

/** Build and verify a provider quote from authoritative Core state only. */
export async function quoteProviderDelivery(
  database: D1Database,
  provider: DeliveryProvider,
  input: Readonly<{
    customerId: string;
    addressId: string;
    providerCode: string;
    serviceType: string;
    marketId: string;
    locationId: string;
    cartId: string;
    address: ProviderCheckoutAddress;
    scheduleAt: string | null;
    now: number;
    /** Revalidation of near-expiry accepted evidence must always ask the provider again. */
    reuseExisting?: boolean;
  }>,
): Promise<CheckoutDeliveryQuote | null> {
  const [profile, market, cart] = await Promise.all([
    database
      .prepare(
        `SELECT sender_name,phone_e164,email,formatted_address,address_line1,address_line2,
                barangay,city,region,postal_code,country_code,pickup_instructions,
                location.latitude,location.longitude
         FROM fulfillment_location_delivery_profile profile
         JOIN fulfillment_location location ON location.id=profile.location_id
         WHERE profile.location_id=? AND location.status='active'`,
      )
      .bind(input.locationId)
      .first<Record<string, string | number | null>>(),
    database
      .prepare("SELECT currency FROM market WHERE id=? AND status='active'")
      .bind(input.marketId)
      .first<{ currency: string }>(),
    database
      .prepare("SELECT COUNT(*) AS line_count FROM cart_item WHERE cart_id=?")
      .bind(input.cartId)
      .first<{ line_count: number }>(),
  ]);
  const recipientAddress = destination(input.address);
  if (
    !profile ||
    !market ||
    market.currency !== "PHP" ||
    !recipientAddress ||
    !/^\+[1-9]\d{7,14}$/.test(input.address.phone) ||
    !cart?.line_count
  )
    return null;
  const deliveryPackage = fixedDeliveryPackage();
  if (input.scheduleAt && !provider.capabilities.scheduledQuotation.supported) return null;
  const scheduleAt = input.scheduleAt ? Date.parse(input.scheduleAt) : null;
  if (
    scheduleAt !== null &&
    (!Number.isFinite(scheduleAt) ||
      scheduleAt <= input.now ||
      (provider.capabilities.scheduledQuotation.maximumAdvanceMilliseconds !== null &&
        scheduleAt - input.now >
          provider.capabilities.scheduledQuotation.maximumAdvanceMilliseconds))
  )
    return null;
  const origin: DeliveryProviderAddress = {
    formattedAddress: String(profile.formatted_address),
    coordinate: {
      latitude: Number(profile.latitude),
      longitude: Number(profile.longitude),
    },
    components: {
      addressLine1: String(profile.address_line1),
      addressLine2: text(profile.address_line2),
      barangay: text(profile.barangay),
      city: String(profile.city),
      region: text(profile.region),
      postalCode: text(profile.postal_code),
      countryCode: String(profile.country_code).toUpperCase(),
    },
    instructions: {
      deliveryInstructions: text(profile.pickup_instructions),
    },
  };
  const quoteRequest: DeliveryProviderRequest = {
    serviceType: input.serviceType,
    currencyCode: market.currency,
    currencyExponent: 2,
    packages: [
      {
        kind: deliveryPackage.kind,
        name: "FreshMarkets grocery order",
        description: "Packed grocery order",
        quantity: deliveryPackage.quantity,
        weightGrams: deliveryPackage.weightGrams,
        priceMinor: null,
      },
    ],
    sender: {
      name: String(profile.sender_name),
      phoneE164: String(profile.phone_e164),
      email: text(profile.email),
      smsEnabled: false,
    },
    recipient: {
      name: input.address.recipient,
      phoneE164: input.address.phone,
      email: null,
      smsEnabled: true,
    },
    origin,
    destination: recipientAddress,
    schedule:
      scheduleAt === null
        ? null
        : {
            pickupFrom: new Date(scheduleAt).toISOString(),
            pickupTo: new Date(scheduleAt + 30 * 60_000).toISOString(),
          },
  };
  const routeFingerprint = await requestHash({
    providerCode: input.providerCode,
    addressId: input.addressId,
    quoteRequest,
  });
  if (input.reuseExisting !== false) {
    const reusable = await findReusableQuote(database, {
      customerId: input.customerId,
      cartId: input.cartId,
      addressId: input.addressId,
      routeFingerprint,
      providerCode: input.providerCode,
      serviceType: input.serviceType,
      currency: market.currency,
      scheduleAt: input.scheduleAt,
      now: input.now,
    });
    if (reusable) return reusable;
  }
  const result = await provider.quote(quoteRequest);
  if (!result.ok || !result.providerRequestId) return null;
  const quote = chooseQuote(result.value, input.serviceType, market.currency, input.now);
  if (!quote) return null;
  return {
    feeMinor: quote.amountMinor,
    snapshot: {
      source: "EXTERNAL_PROVIDER",
      providerCode: input.providerCode,
      providerQuotationId: quote.providerQuotationId!,
      providerRequestId: result.providerRequestId,
      serviceType: quote.serviceType,
      quotedAt: new Date(input.now).toISOString(),
      expiresAt: quote.expiresAt!,
      scheduleAt: input.scheduleAt,
      currency: quote.currency,
      amountMinor: quote.amountMinor,
      distanceMeters: quote.distanceMeters,
      routeFingerprint,
    },
  };
}
