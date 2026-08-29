import type {
  AddressComponents,
  AddressComponentsSource,
  CoordinateConfirmationSource,
  CreateCustomerAddressRequest,
  DeliveryInstructions,
  ServiceabilityFailureReason,
  UpdateCustomerAddressRequest,
} from "@freshmarkets/contracts";
import { drizzle } from "drizzle-orm/d1";
import type { GeocoderPort, PermanentGeocode } from "../geography/ports/geocoder";
import { resolveServiceability } from "../geography/serviceability";

type CustomerAddressRow = {
  id: string;
  customer_id: string;
  label: string;
  recipient: string;
  phone: string;
  address_json: string;
  address_components_json: string | null;
  barangay: string | null;
  city: string | null;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  geocode_provider: string | null;
  geocode_reference: string | null;
  confirmation_source: CoordinateConfirmationSource | null;
  user_confirmed_at: number | null;
  delivery_instructions_json: string | null;
  service_area_code: string | null;
  delivery_zone_code: string | null;
  resolution_version: number | null;
  serviceable: number | null;
  serviceability_reason: ServiceabilityFailureReason | null;
  notes: string | null;
  status: "active" | "disabled";
  version: number;
  created_at: number;
  updated_at: number;
};

const ADDRESS_COLUMNS =
  "id, customer_id, label, recipient, phone, address_json, address_components_json, barangay, city, postal_code, latitude, longitude, geocode_provider, geocode_reference, confirmation_source, user_confirmed_at, delivery_instructions_json, service_area_code, delivery_zone_code, resolution_version, serviceable, serviceability_reason, notes, status, version, created_at, updated_at";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export function customerAddressView(row: CustomerAddressRow) {
  return {
    id: row.id,
    label: row.label,
    recipient: row.recipient,
    phone: row.phone,
    components: parseComponents(row.address_components_json, row.address_json),
    confirmationSource: row.confirmation_source,
    confirmedAt:
      row.user_confirmed_at === null ? null : new Date(row.user_confirmed_at).toISOString(),
    instructions: parseInstructions(row.delivery_instructions_json),
    latitude: row.latitude,
    longitude: row.longitude,
    serviceable: row.serviceable === null ? null : row.serviceable === 1,
    serviceabilityReason: row.serviceability_reason,
    serviceAreaCode: row.service_area_code,
    deliveryZoneCode: row.delivery_zone_code,
    resolutionVersion: row.resolution_version,
    status: row.status,
    version: row.version,
  };
}

/** Persist a saved address with Customers-owned fields and Geography-owned resolution. */
export async function createCustomerAddress(
  database: D1Database,
  geocoder: GeocoderPort,
  command: { customerId: string } & CreateCustomerAddressRequest,
): Promise<
  | { ok: true; value: ReturnType<typeof customerAddressView>; requestId: string }
  | ReturnType<typeof failure>
> {
  const geo = await resolveServiceability(drizzle(database), command);
  if (!geo.ok) return { ok: false as const, error: geo.error };
  const id = crypto.randomUUID();
  const now = Date.now();
  const structured = "components" in command && command.components !== undefined;
  const componentsSource = (command as unknown as { componentsSource?: AddressComponentsSource })
    .componentsSource;
  if (structured && (!componentsSource || componentsSource === "SAVED_ADDRESS"))
    return failure(
      "VALIDATION_FAILED",
      "New structured address components require valid provenance",
      command.requestId,
    );
  const confirmation = structured
    ? await finalizeConfirmation(geocoder, {
        latitude: command.latitude,
        longitude: command.longitude,
        components: command.components!,
        componentsSource: componentsSource!,
        source: command.confirmationSource!,
        confirmedAt: now,
      })
    : null;
  const addressJson = structured ? JSON.stringify(confirmation!.components) : command.addressJson;

  await database
    .prepare(
      "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, address_components_json, barangay, city, postal_code, latitude, longitude, geocode_provider, geocode_reference, confirmation_source, user_confirmed_at, delivery_instructions_json, service_area_code, delivery_zone_code, resolution_version, serviceable, serviceability_reason, notes, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)",
    )
    .bind(
      id,
      command.customerId,
      command.label,
      command.recipient,
      command.phone,
      addressJson,
      confirmation ? JSON.stringify(confirmation.components) : null,
      confirmation?.components.barangay ?? null,
      confirmation?.components.city ?? null,
      confirmation?.components.postalCode ?? null,
      command.latitude,
      command.longitude,
      confirmation?.provider ?? null,
      confirmation?.providerReference ?? null,
      confirmation?.source ?? null,
      confirmation?.confirmedAt ?? null,
      structured ? JSON.stringify(command.instructions) : null,
      geo.value.serviceArea?.code ?? null,
      geo.value.deliveryZone?.code ?? null,
      geo.value.serviceArea?.polygonVersion ?? null,
      geo.value.serviceable ? 1 : 0,
      geo.value.reason,
      command.notes ?? null,
      now,
      now,
    )
    .run();

  const row = await database
    .prepare(`SELECT ${ADDRESS_COLUMNS} FROM customer_address WHERE id=? AND customer_id=?`)
    .bind(id, command.customerId)
    .first<CustomerAddressRow>();
  if (!row)
    return failure("INTERNAL_ERROR", "Created address could not be read", command.requestId);
  return { ok: true as const, value: customerAddressView(row), requestId: command.requestId };
}

export async function listCustomerAddresses(
  database: D1Database,
  query: { customerId: string; requestId: string },
): Promise<{
  ok: true;
  value: Array<ReturnType<typeof customerAddressView>>;
  requestId: string;
}> {
  const rows = await database
    .prepare(
      `SELECT ${ADDRESS_COLUMNS} FROM customer_address WHERE customer_id=? AND status='active' ORDER BY updated_at DESC, id DESC`,
    )
    .bind(query.customerId)
    .all<CustomerAddressRow>();
  return {
    ok: true as const,
    value: rows.results.map(customerAddressView),
    requestId: query.requestId,
  };
}

/** Owner-scoped optimistic update; coordinate changes always receive fresh serviceability. */
export async function updateCustomerAddress(
  database: D1Database,
  geocoder: GeocoderPort,
  command: { customerId: string } & UpdateCustomerAddressRequest,
): Promise<
  | { ok: true; value: ReturnType<typeof customerAddressView>; requestId: string }
  | ReturnType<typeof failure>
> {
  const current = await database
    .prepare(
      `SELECT ${ADDRESS_COLUMNS} FROM customer_address WHERE id=? AND customer_id=? AND status='active'`,
    )
    .bind(command.addressId, command.customerId)
    .first<CustomerAddressRow>();
  if (!current) return failure("NOT_FOUND", "Customer address not found", command.requestId);

  const hasLatitude = command.latitude !== undefined;
  const hasLongitude = command.longitude !== undefined;
  const hasCoordinatePair = hasLatitude && hasLongitude;
  if (hasLatitude !== hasLongitude)
    return failure(
      "VALIDATION_FAILED",
      "Latitude and longitude must be provided together",
      command.requestId,
    );
  if (command.confirmationSource !== undefined && !hasCoordinatePair)
    return failure(
      "VALIDATION_FAILED",
      "Confirmation source requires latitude and longitude",
      command.requestId,
    );
  const explicitLegacyCoordinateEdit =
    hasCoordinatePair &&
    current.address_components_json === null &&
    command.addressJson !== undefined &&
    command.components === undefined &&
    command.instructions === undefined;
  if (
    hasCoordinatePair &&
    command.confirmationSource === undefined &&
    !explicitLegacyCoordinateEdit
  )
    return failure(
      "VALIDATION_FAILED",
      "Structured coordinate edits require confirmation source",
      command.requestId,
    );

  const latitude = command.latitude ?? current.latitude;
  const longitude = command.longitude ?? current.longitude;
  const locationChanged = latitude !== current.latitude || longitude !== current.longitude;
  let serviceability = {
    serviceAreaCode: current.service_area_code,
    deliveryZoneCode: current.delivery_zone_code,
    resolutionVersion: current.resolution_version,
    serviceable: current.serviceable,
    reason: current.serviceability_reason,
  };
  if (locationChanged) {
    const geo = await resolveServiceability(drizzle(database), {
      requestId: command.requestId,
      latitude,
      longitude,
      previousResolution:
        current.service_area_code && current.resolution_version !== null
          ? {
              serviceAreaCode: current.service_area_code,
              serviceAreaPolygonVersion: current.resolution_version,
              deliveryZoneCode: current.delivery_zone_code,
              deliveryZonePolygonVersion: null,
            }
          : undefined,
    });
    if (!geo.ok) return geo;
    serviceability = {
      serviceAreaCode: geo.value.serviceArea?.code ?? null,
      deliveryZoneCode: geo.value.deliveryZone?.code ?? null,
      resolutionVersion: geo.value.serviceArea?.polygonVersion ?? null,
      serviceable: geo.value.serviceable ? 1 : 0,
      reason: geo.value.reason,
    };
  }

  const now = Date.now();
  const currentComponents = parseComponents(current.address_components_json, current.address_json);
  if (command.components !== undefined && command.componentsSource === undefined)
    return failure(
      "VALIDATION_FAILED",
      "Structured address components require provenance",
      command.requestId,
    );
  if (command.components === undefined && command.componentsSource !== undefined)
    return failure(
      "VALIDATION_FAILED",
      "Component provenance requires structured address components",
      command.requestId,
    );
  if (
    command.componentsSource === "SAVED_ADDRESS" &&
    command.components &&
    !componentsEqual(command.components, currentComponents)
  )
    return failure(
      "VALIDATION_FAILED",
      "Saved address provenance cannot describe changed components",
      command.requestId,
    );
  const confirmation = command.confirmationSource
    ? await finalizeConfirmation(geocoder, {
        latitude,
        longitude,
        components: command.components ?? currentComponents,
        componentsSource: command.componentsSource ?? "SAVED_ADDRESS",
        persistedProvider: current.geocode_provider,
        locationChanged,
        source: command.confirmationSource,
        confirmedAt: now,
      })
    : null;
  const components = confirmation?.components ?? command.components ?? currentComponents;
  const instructions =
    command.instructions ?? parseInstructions(current.delivery_instructions_json);
  const canonicalFieldsPresent =
    current.address_components_json !== null ||
    command.components !== undefined ||
    command.confirmationSource !== undefined ||
    command.instructions !== undefined;
  const preserveSavedProvider =
    command.componentsSource === "SAVED_ADDRESS" &&
    !locationChanged &&
    confirmation?.provider === null;
  const geocodeProvider = confirmation
    ? preserveSavedProvider
      ? current.geocode_provider
      : confirmation.provider
    : locationChanged
      ? null
      : current.geocode_provider;
  const geocodeReference = confirmation
    ? preserveSavedProvider
      ? current.geocode_reference
      : confirmation.providerReference
    : locationChanged
      ? null
      : current.geocode_reference;
  const confirmationSource = confirmation
    ? confirmation.source
    : locationChanged
      ? null
      : current.confirmation_source;
  const confirmedAt = confirmation
    ? confirmation.confirmedAt
    : locationChanged
      ? null
      : current.user_confirmed_at;
  const addressJson = canonicalFieldsPresent
    ? JSON.stringify(components)
    : (command.addressJson ?? current.address_json);

  const updated = await database
    .prepare(
      "UPDATE customer_address SET label=?, recipient=?, phone=?, address_json=?, address_components_json=?, barangay=?, city=?, postal_code=?, latitude=?, longitude=?, geocode_provider=?, geocode_reference=?, confirmation_source=?, user_confirmed_at=?, delivery_instructions_json=?, service_area_code=?, delivery_zone_code=?, resolution_version=?, serviceable=?, serviceability_reason=?, notes=?, version=version+1, updated_at=? WHERE id=? AND customer_id=? AND status='active' AND version=?",
    )
    .bind(
      command.label ?? current.label,
      command.recipient ?? current.recipient,
      command.phone ?? current.phone,
      addressJson,
      canonicalFieldsPresent ? JSON.stringify(components) : null,
      canonicalFieldsPresent ? components.barangay : null,
      canonicalFieldsPresent ? components.city : null,
      canonicalFieldsPresent ? components.postalCode : null,
      latitude,
      longitude,
      geocodeProvider,
      geocodeReference,
      confirmationSource,
      confirmedAt,
      canonicalFieldsPresent ? JSON.stringify(instructions) : null,
      serviceability.serviceAreaCode,
      serviceability.deliveryZoneCode,
      serviceability.resolutionVersion,
      serviceability.serviceable,
      serviceability.reason,
      command.notes !== undefined ? command.notes : current.notes,
      now,
      current.id,
      command.customerId,
      command.expectedVersion,
    )
    .run();
  if ((updated.meta?.changes ?? 0) !== 1)
    return failure("STALE_VERSION", "Address changed; refresh before updating", command.requestId);

  const row = await database
    .prepare(`SELECT ${ADDRESS_COLUMNS} FROM customer_address WHERE id=? AND customer_id=?`)
    .bind(current.id, command.customerId)
    .first<CustomerAddressRow>();
  if (!row)
    return failure("INTERNAL_ERROR", "Updated address could not be read", command.requestId);
  return { ok: true as const, value: customerAddressView(row), requestId: command.requestId };
}

type FinalizedConfirmation = {
  components: AddressComponents;
  provider: string | null;
  providerReference: string | null;
  source: CoordinateConfirmationSource;
  confirmedAt: number;
};

async function finalizeConfirmation(
  geocoder: GeocoderPort,
  input: {
    latitude: number;
    longitude: number;
    components: AddressComponents;
    componentsSource: AddressComponentsSource;
    persistedProvider?: string | null;
    locationChanged?: boolean;
    source: CoordinateConfirmationSource;
    confirmedAt: number;
  },
): Promise<FinalizedConfirmation> {
  const requiresPermanentComponents =
    input.source === "GEOCODER" ||
    input.componentsSource === "TEMPORARY_GEOCODER" ||
    (input.componentsSource === "SAVED_ADDRESS" &&
      input.locationChanged === true &&
      input.persistedProvider !== null &&
      input.persistedProvider !== undefined);
  if (!requiresPermanentComponents)
    return {
      components: input.components,
      provider: null,
      providerReference: null,
      source: input.source,
      confirmedAt: input.confirmedAt,
    };
  const permanent: PermanentGeocode = await geocoder.reversePermanent({
    coordinate: { latitude: input.latitude, longitude: input.longitude },
  });
  return {
    components: permanent.components,
    provider: permanent.provider,
    providerReference: permanent.providerReference,
    source: input.source,
    confirmedAt: input.confirmedAt,
  };
}

function componentsEqual(left: AddressComponents, right: AddressComponents): boolean {
  return (
    left.addressLine1 === right.addressLine1 &&
    left.addressLine2 === right.addressLine2 &&
    left.barangay === right.barangay &&
    left.city === right.city &&
    left.region === right.region &&
    left.postalCode === right.postalCode &&
    left.countryCode === right.countryCode
  );
}

function parseComponents(structuredJson: string | null, legacyJson: string): AddressComponents {
  const structured = parseRecord(structuredJson);
  if (isAddressComponents(structured)) return structured;
  const legacy = parseRecord(legacyJson);
  const addressLine1 = stringField(legacy, "addressLine1") ?? stringField(legacy, "line1") ?? "";
  const city = stringField(legacy, "city") ?? addressLine1;
  return {
    addressLine1,
    addressLine2: stringField(legacy, "addressLine2") ?? stringField(legacy, "line2"),
    barangay: stringField(legacy, "barangay"),
    city,
    region: stringField(legacy, "region"),
    postalCode: stringField(legacy, "postalCode"),
    countryCode: stringField(legacy, "countryCode") ?? "PH",
  };
}

function parseInstructions(value: string | null): DeliveryInstructions {
  const parsed = parseRecord(value);
  return {
    buildingUnit: stringField(parsed, "buildingUnit"),
    landmark: stringField(parsed, "landmark"),
    gateGuard: stringField(parsed, "gateGuard"),
    deliveryNote: stringField(parsed, "deliveryNote"),
    recipientInstruction: stringField(parsed, "recipientInstruction"),
  };
}

function parseRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function isAddressComponents(value: Record<string, unknown> | null): value is AddressComponents {
  return (
    typeof value?.addressLine1 === "string" &&
    typeof value.city === "string" &&
    typeof value.countryCode === "string"
  );
}
