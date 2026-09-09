import { finalizeAddressConfirmation as finalizeConfirmation } from "../geography/application/finalize-address-confirmation";
import type {
  AddressComponents,
  AddressComponentsSource,
  CoordinateConfirmationSource,
  CreateCustomerAddressRequest,
  DeliveryInstructions,
  ServiceabilityFailureReason,
  UpdateCustomerAddressRequest,
} from "@freshmarkets/contracts";
import type { AppErrorCode } from "@freshmarkets/contracts";
import { drizzle } from "drizzle-orm/d1";
import type { GeocoderPort } from "../geography/ports/geocoder";
import { resolveServiceability } from "../geography/serviceability";
import { normalizePhilippineMobile } from "./domain/customer-phone";
import { auditEventStatement } from "../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../idempotency";

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

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

type AddressWrite = { scope: string; key: string; hash: string; actorUserId: string };

async function replayAddressWrite(
  database: D1Database,
  write: AddressWrite,
  customerId: string,
  requestId: string,
) {
  const saved = await findIdempotencyRecord(database, write.scope, write.key);
  if (!saved) return null;
  if (saved.requestHash !== write.hash)
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "This request key was used for another address change",
      requestId,
    );
  if (saved.status !== "SUCCEEDED") return null;
  let row: CustomerAddressRow;
  try {
    row = JSON.parse(saved.resultReference ?? "null") as CustomerAddressRow;
    if (
      !row ||
      row.customer_id !== customerId ||
      typeof row.id !== "string" ||
      !Number.isSafeInteger(row.version) ||
      !ADDRESS_COLUMNS.split(", ").every((column) => Object.hasOwn(row, column))
    )
      return failure("INTERNAL_ERROR", "Saved address result is unavailable", requestId);
    return { ok: true as const, value: customerAddressView(row), requestId };
  } catch {
    return failure("INTERNAL_ERROR", "Saved address result is unavailable", requestId);
  }
}

/** Reuse the same ownership and replay boundary for both address writes. */
async function beginAddressWrite(
  database: D1Database,
  action: "create" | "update",
  command: { customerId: string } & (CreateCustomerAddressRequest | UpdateCustomerAddressRequest),
) {
  if (!command.idempotencyKey?.trim() || command.idempotencyKey.length > 200)
    return failure(
      "VALIDATION_FAILED",
      "A stable address request key is required",
      command.requestId,
    );
  const actor = await database
    .prepare(
      "SELECT c.auth_user_id AS userId FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id WHERE c.id=? AND c.status='active' AND cp.status='active'",
    )
    .bind(command.customerId)
    .first<{ userId: string }>();
  if (!actor)
    return failure("FORBIDDEN", "An active customer account is required", command.requestId);
  const { headers: _headers, requestId: _requestId, idempotencyKey: _key, ...intent } = command;
  const write: AddressWrite = {
    scope: `customer.address.${action}`,
    key: `${actor.userId}:${command.idempotencyKey}`,
    hash: await requestHash(intent),
    actorUserId: actor.userId,
  };
  return (
    (await replayAddressWrite(database, write, command.customerId, command.requestId)) ?? { write }
  );
}

/** One row supplies both bound SQL values and the immutable result snapshot. */
async function persistAddress(
  database: D1Database,
  write: AddressWrite,
  row: CustomerAddressRow,
  requestId: string,
  expectedVersion?: number,
) {
  const columns = ADDRESS_COLUMNS.split(", ") as Array<keyof CustomerAddressRow>;
  const mutable = columns.filter(
    (column) => column !== "id" && column !== "customer_id" && column !== "created_at",
  );
  const statement =
    expectedVersion === undefined
      ? database
          .prepare(
            `INSERT INTO customer_address (${ADDRESS_COLUMNS}) VALUES (${columns.map(() => "?").join(",")})`,
          )
          .bind(...columns.map((column) => row[column]))
      : database
          .prepare(
            `UPDATE customer_address SET ${mutable.map((column) => `${column}=?`).join(",")} WHERE id=? AND customer_id=? AND status='active' AND version=?`,
          )
          .bind(...mutable.map((column) => row[column]), row.id, row.customer_id, expectedVersion);
  const required = () =>
    database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1");
  try {
    await database.batch([
      database
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','customer_address_row_snapshot',?,?) ON CONFLICT(scope,idempotency_key) DO NOTHING",
        )
        .bind(write.scope, write.key, write.hash, row.updated_at, row.updated_at),
      required(),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(SELECT 1 FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id WHERE c.id=? AND c.auth_user_id=? AND c.status='active' AND cp.status='active')",
        )
        .bind(row.customer_id, write.actorUserId),
      statement,
      required(),
      auditEventStatement(database, {
        actorUserId: write.actorUserId,
        action:
          expectedVersion === undefined ? "CUSTOMER.ADDRESS_CREATED" : "CUSTOMER.ADDRESS_UPDATED",
        resourceType: "customer_address",
        resourceId: row.id,
        details: { version: row.version },
        correlationId: requestId,
        idempotencyKey: `${write.scope}:${write.key}`,
        occurredAt: row.updated_at,
      }),
      required(),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(row), row.updated_at, write.scope, write.key, write.hash),
      required(),
    ]);
    return { ok: true as const, value: customerAddressView(row), requestId };
  } catch (error) {
    const replay = await replayAddressWrite(database, write, row.customer_id, requestId);
    if (replay) return replay;
    if (error instanceof Error && error.message.includes("CHECK constraint failed: id = 0"))
      return failure(
        "CONFLICT",
        "The address changed or could not be saved. Refresh and retry.",
        requestId,
      );
    throw error;
  }
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
  const start = await beginAddressWrite(database, "create", command);
  if (!("write" in start)) return start;
  const phone = normalizePhilippineMobile(command.phone);
  if (!phone)
    return failure(
      "VALIDATION_FAILED",
      "A valid Philippine mobile number is required",
      command.requestId,
    );
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

  const row: CustomerAddressRow = {
    id,
    customer_id: command.customerId,
    label: command.label,
    recipient: command.recipient,
    phone,
    address_json: addressJson!,
    address_components_json: structured ? JSON.stringify(confirmation!.components) : null,
    barangay: confirmation?.components.barangay ?? null,
    city: confirmation?.components.city ?? null,
    postal_code: confirmation?.components.postalCode ?? null,
    latitude: command.latitude,
    longitude: command.longitude,
    geocode_provider: confirmation?.provider ?? null,
    geocode_reference: confirmation?.providerReference ?? null,
    confirmation_source: confirmation?.source ?? null,
    user_confirmed_at: confirmation?.confirmedAt ?? null,
    delivery_instructions_json: structured ? JSON.stringify(command.instructions) : null,
    service_area_code: geo.value.serviceArea?.code ?? null,
    delivery_zone_code: geo.value.deliveryZone?.code ?? null,
    resolution_version: geo.value.serviceArea?.polygonVersion ?? null,
    serviceable: geo.value.serviceable ? 1 : 0,
    serviceability_reason: geo.value.reason,
    notes: command.notes ?? null,
    status: "active",
    version: 1,
    created_at: now,
    updated_at: now,
  };
  return persistAddress(database, start.write, row, command.requestId);
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
  const start = await beginAddressWrite(database, "update", command);
  if (!("write" in start)) return start;
  const current = await database
    .prepare(
      `SELECT ${ADDRESS_COLUMNS} FROM customer_address WHERE id=? AND customer_id=? AND status='active'`,
    )
    .bind(command.addressId, command.customerId)
    .first<CustomerAddressRow>();
  if (!current) return failure("NOT_FOUND", "Customer address not found", command.requestId);
  if (current.version !== command.expectedVersion)
    return failure("STALE_VERSION", "Address changed; refresh before updating", command.requestId);
  const phone =
    command.phone === undefined ? current.phone : normalizePhilippineMobile(command.phone);
  if (!phone)
    return failure(
      "VALIDATION_FAILED",
      "A valid Philippine mobile number is required",
      command.requestId,
    );

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
  if (
    command.componentsSource === "TEMPORARY_GEOCODER" &&
    (!hasCoordinatePair || command.confirmationSource === undefined)
  )
    return failure(
      "VALIDATION_FAILED",
      "Temporary geocoder components require a final confirmed coordinate",
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
  const effectiveComponentsSource = command.componentsSource ?? "SAVED_ADDRESS";
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
        componentsSource: effectiveComponentsSource,
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
    effectiveComponentsSource === "SAVED_ADDRESS" &&
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

  const row: CustomerAddressRow = {
    ...current,
    label: command.label ?? current.label,
    recipient: command.recipient ?? current.recipient,
    phone,
    address_json: addressJson,
    address_components_json: canonicalFieldsPresent ? JSON.stringify(components) : null,
    barangay: canonicalFieldsPresent ? components.barangay : null,
    city: canonicalFieldsPresent ? components.city : null,
    postal_code: canonicalFieldsPresent ? components.postalCode : null,
    latitude,
    longitude,
    geocode_provider: geocodeProvider,
    geocode_reference: geocodeReference,
    confirmation_source: confirmationSource,
    user_confirmed_at: confirmedAt,
    delivery_instructions_json: canonicalFieldsPresent ? JSON.stringify(instructions) : null,
    service_area_code: serviceability.serviceAreaCode,
    delivery_zone_code: serviceability.deliveryZoneCode,
    resolution_version: serviceability.resolutionVersion,
    serviceable: serviceability.serviceable,
    serviceability_reason: serviceability.reason,
    notes: command.notes !== undefined ? command.notes : current.notes,
    version: current.version + 1,
    updated_at: now,
  };
  return persistAddress(database, start.write, row, command.requestId, command.expectedVersion);
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
