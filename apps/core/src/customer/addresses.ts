import type {
  CreateCustomerAddressRequest,
  ServiceabilityFailureReason,
  UpdateCustomerAddressRequest,
} from "@freshmarkets/contracts";
import { drizzle } from "drizzle-orm/d1";
import { resolveServiceability } from "../geography/serviceability";

type Database = ReturnType<typeof drizzle>;

type CustomerAddressRow = {
  id: string;
  customer_id: string;
  label: string;
  recipient: string;
  phone: string;
  address_json: string;
  latitude: number;
  longitude: number;
  service_area_code: string | null;
  delivery_zone_code: string | null;
  resolution_version: number | null;
  serviceable: number | null;
  serviceability_reason: ServiceabilityFailureReason | null;
  notes: string | null;
  status: string;
  version: number;
  created_at: number;
  updated_at: number;
};

const ADDRESS_COLUMNS =
  "id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, resolution_version, serviceable, serviceability_reason, notes, status, version, created_at, updated_at";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export function customerAddressView(row: CustomerAddressRow) {
  return {
    id: row.id,
    label: row.label,
    recipient: row.recipient,
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

/**
 * Persist a saved address with Core's authoritative serviceability outcome.
 * Customers owns addresses; Geography owns the zone/service-area resolution
 * persisted alongside them.
 */
export async function createCustomerAddress(
  database: D1Database,
  command: { customerId: string } & CreateCustomerAddressRequest,
): Promise<
  | { ok: true; value: ReturnType<typeof customerAddressView>; requestId: string }
  | ReturnType<typeof failure>
> {
  const geo = await resolveServiceability(drizzle(database), command);
  if (!geo.ok) return { ok: false as const, error: geo.error };
  const id = crypto.randomUUID();
  const now = Date.now();
  await database
    .prepare(
      "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, resolution_version, serviceable, serviceability_reason, notes, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)",
    )
    .bind(
      id,
      command.customerId,
      command.label,
      command.recipient,
      command.phone,
      command.addressJson,
      command.latitude,
      command.longitude,
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
  return {
    ok: true as const,
    value: {
      id,
      label: command.label,
      recipient: command.recipient,
      latitude: command.latitude,
      longitude: command.longitude,
      serviceable: geo.value.serviceable,
      serviceabilityReason: geo.value.reason,
      serviceAreaCode: geo.value.serviceArea?.code ?? null,
      deliveryZoneCode: geo.value.deliveryZone?.code ?? null,
      resolutionVersion: geo.value.serviceArea?.polygonVersion ?? null,
      status: "active",
      version: 1,
    },
    requestId: command.requestId,
  };
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

/**
 * Owner-scoped optimistic-version address update. A coordinate change
 * re-resolves serviceability and persists the fresh outcome; unchanged
 * coordinates retain the stored resolution.
 */
export async function updateCustomerAddress(
  database: D1Database,
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

  const updated = await database
    .prepare(
      "UPDATE customer_address SET label=?, recipient=?, phone=?, address_json=?, latitude=?, longitude=?, service_area_code=?, delivery_zone_code=?, resolution_version=?, serviceable=?, serviceability_reason=?, notes=?, version=version+1, updated_at=? WHERE id=? AND customer_id=? AND status='active' AND version=?",
    )
    .bind(
      command.label ?? current.label,
      command.recipient ?? current.recipient,
      command.phone ?? current.phone,
      command.addressJson ?? current.address_json,
      latitude,
      longitude,
      serviceability.serviceAreaCode,
      serviceability.deliveryZoneCode,
      serviceability.resolutionVersion,
      serviceability.serviceable,
      serviceability.reason,
      command.notes !== undefined ? command.notes : current.notes,
      Date.now(),
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
