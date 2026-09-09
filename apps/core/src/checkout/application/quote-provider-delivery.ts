import type { AddressComponents, DeliveryInstructions } from "@freshmarkets/contracts";
import { deliveryPackageKind } from "../../fulfillment/domain/delivery-package";
import type {
  DeliveryProvider,
  DeliveryProviderAddress,
  DeliveryQuote,
} from "../../delivery/ports/delivery-provider";

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
    buildingUnit: field(instructionsObject, "buildingUnit"),
    landmark: field(instructionsObject, "landmark"),
    gateGuard: field(instructionsObject, "gateGuard"),
    deliveryNote: field(instructionsObject, "deliveryNote"),
    recipientInstruction: field(instructionsObject, "recipientInstruction"),
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

/** Build and verify a provider quote from authoritative Core state only. */
export async function quoteProviderDelivery(
  database: D1Database,
  provider: DeliveryProvider,
  input: Readonly<{
    providerCode: string;
    serviceType: string;
    marketId: string;
    locationId: string;
    cartId: string;
    address: ProviderCheckoutAddress;
    scheduleAt: string | null;
    now: number;
  }>,
): Promise<CheckoutDeliveryQuote | null> {
  const [profile, market, weight] = await Promise.all([
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
      .prepare(
        `SELECT COUNT(*) AS line_count,
                SUM(CASE WHEN unit.canonical_base_code='GRAM'
                     THEN item.quantity*sku.consumption_base_quantity
                     ELSE item.quantity*sku.estimated_shipping_weight_grams END) AS grams,
                SUM(CASE WHEN unit.canonical_base_code<>'GRAM'
                           AND sku.estimated_shipping_weight_grams IS NULL THEN 1 ELSE 0 END) AS missing
         FROM cart_item item
         JOIN sku ON sku.id=item.sku_id
         JOIN product ON product.id=sku.product_id
         JOIN inventory_pool pool ON pool.id=COALESCE(sku.stock_pool_id,product.inventory_pool_id)
         JOIN unit ON unit.id=pool.base_unit_id
         WHERE item.cart_id=?`,
      )
      .bind(input.cartId)
      .first<{ line_count: number; grams: number | null; missing: number }>(),
  ]);
  const recipientAddress = destination(input.address);
  if (
    !profile ||
    !market ||
    market.currency !== "PHP" ||
    !recipientAddress ||
    !/^\+[1-9]\d{7,14}$/.test(input.address.phone) ||
    !weight?.line_count ||
    weight.missing > 0 ||
    !Number.isSafeInteger(weight.grams) ||
    weight.grams! <= 0
  )
    return null;
  const packageKind = deliveryPackageKind(weight.grams!);
  if (!packageKind) return null;
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
      buildingUnit: null,
      landmark: null,
      gateGuard: null,
      deliveryNote: text(profile.pickup_instructions),
      recipientInstruction: null,
    },
  };
  const result = await provider.quote({
    serviceType: input.serviceType,
    currencyCode: market.currency,
    currencyExponent: 2,
    packages: [
      {
        kind: packageKind,
        name: "FreshMarkets grocery order",
        description: "Packed grocery order",
        quantity: 1,
        weightGrams: weight.grams!,
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
  });
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
    },
  };
}
