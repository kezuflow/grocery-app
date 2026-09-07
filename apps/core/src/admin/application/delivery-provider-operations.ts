import type { RefreshExternalDeliveryRequest } from "@freshmarkets/contracts";
import { applyProviderObservation } from "../../delivery/application/apply-provider-observation";
import type {
  AddressComponents,
  AppErrorCode,
  DeliveryInstructions,
  ExternalDeliveryMutationRequest,
  ExternalDeliveryDispatchView,
  LocationDeliveryProfileView,
  RequestExternalDeliveryRequest,
  RpcResult,
  UpsertLocationDeliveryProfileRequest,
} from "@freshmarkets/contracts";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { claimCommandIdempotency, requestHash } from "../../idempotency";
import { resolveOrderDeliveryPackage } from "../../fulfillment/application/resolve-order-delivery-package";
import {
  requestProviderDelivery,
  type ProviderDispatchView,
} from "../../delivery/application/request-provider-delivery";
import type { DeliveryProvider } from "../../delivery/ports/delivery-provider";
import type { ProviderDelivery } from "../../delivery/ports/delivery-provider";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";

type DeliveryProfileRow = {
  location_id: string;
  location_name: string;
  latitude: number;
  longitude: number;
  sender_name: string | null;
  phone_e164: string | null;
  email: string | null;
  formatted_address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  barangay: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
  pickup_instructions: string | null;
  profile_version: number | null;
};

type DispatchSourceRow = {
  job_id: string;
  order_id: string;
  job_version: number;
  job_status: string;
  fulfillment_mode: "INSTANT" | "SCHEDULED";
  location_id: string;
  cycle_id: string | null;
  batch_id: string | null;
  rider_id: string | null;
  promised_at: number | null;
  delivery_date: number | null;
  delivery_execution_snapshot_json: string | null;
  currency: string;
  total_minor: number;
  latitude: number | null;
  longitude: number | null;
  address_snapshot_json: string;
  contact_snapshot_json: string;
  instructions_snapshot: string | null;
  sender_name: string | null;
  phone_e164: string | null;
  email: string | null;
  origin_latitude: number;
  origin_longitude: number;
  formatted_address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  barangay: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
  pickup_instructions: string | null;
};

const EMPTY_INSTRUCTIONS: DeliveryInstructions = {
  buildingUnit: null,
  landmark: null,
  gateGuard: null,
  deliveryNote: null,
  recipientInstruction: null,
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? "";
  return cleaned || null;
}

function profileView(row: DeliveryProfileRow): LocationDeliveryProfileView {
  const complete =
    row.sender_name !== null &&
    row.phone_e164 !== null &&
    row.formatted_address !== null &&
    row.address_line1 !== null &&
    row.city !== null &&
    row.country_code !== null &&
    row.profile_version !== null;
  return {
    locationId: row.location_id,
    locationName: row.location_name,
    coordinate: { latitude: row.latitude, longitude: row.longitude },
    profile: complete
      ? {
          senderName: row.sender_name!,
          phoneE164: row.phone_e164!,
          email: row.email,
          formattedAddress: row.formatted_address!,
          addressLine1: row.address_line1!,
          addressLine2: row.address_line2,
          barangay: row.barangay,
          city: row.city!,
          region: row.region,
          postalCode: row.postal_code,
          countryCode: row.country_code!,
          pickupInstructions: row.pickup_instructions,
          version: row.profile_version!,
        }
      : null,
  };
}

async function loadProfile(
  database: D1Database,
  locationId: string,
): Promise<LocationDeliveryProfileView | null> {
  const row = await database
    .prepare(
      `SELECT location.id AS location_id, location.name AS location_name,
              location.latitude, location.longitude,
              profile.sender_name, profile.phone_e164, profile.email,
              profile.formatted_address, profile.address_line1, profile.address_line2,
              profile.barangay, profile.city, profile.region, profile.postal_code,
              profile.country_code, profile.pickup_instructions,
              profile.version AS profile_version
       FROM fulfillment_location location
       LEFT JOIN fulfillment_location_delivery_profile profile
         ON profile.location_id=location.id
       WHERE location.id=? AND location.status='active'`,
    )
    .bind(locationId)
    .first<DeliveryProfileRow>();
  return row ? profileView(row) : null;
}

export async function getLocationDeliveryProfile(
  deps: OperationsAdministrationDeps,
  request: { requestId: string; headers: Readonly<Record<string, string>>; locationId: string },
): Promise<RpcResult<LocationDeliveryProfileView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.read",
    request.locationId,
    { concealOutOfScopeLocation: true },
  );
  if (!access.ok) return access;
  const view = await loadProfile(deps.db, request.locationId);
  return view
    ? { ok: true, value: view, requestId: request.requestId }
    : failure("NOT_FOUND", "Active fulfillment location not found", request.requestId);
}

function completeIdempotency(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  now: number,
) {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, now, scope, key);
}

async function failIdempotency(database: D1Database, scope: string, key: string) {
  await database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED',updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

export async function upsertLocationDeliveryProfile(
  deps: OperationsAdministrationDeps,
  request: UpsertLocationDeliveryProfileRequest,
): Promise<RpcResult<LocationDeliveryProfileView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  const normalized = {
    senderName: request.senderName.trim(),
    phoneE164: request.phoneE164.trim(),
    email: cleanOptional(request.email)?.toLowerCase() ?? null,
    formattedAddress: request.formattedAddress.trim(),
    addressLine1: request.addressLine1.trim(),
    addressLine2: cleanOptional(request.addressLine2),
    barangay: cleanOptional(request.barangay),
    city: request.city.trim(),
    region: cleanOptional(request.region),
    postalCode: cleanOptional(request.postalCode),
    countryCode: request.countryCode.trim().toUpperCase(),
    pickupInstructions: cleanOptional(request.pickupInstructions),
  };
  const scope = "admin.delivery.locationProfile";
  const claim = await claimCommandIdempotency(deps.db, Date.now, scope, request.idempotencyKey, {
    locationId: request.locationId,
    expectedVersion: request.expectedVersion,
    ...normalized,
  });
  if (!claim.claimed) {
    if (claim.existing?.requestHash !== claim.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different store profile",
        request.requestId,
      );
    if (claim.existing?.status === "SUCCEEDED") {
      const replay = await loadProfile(deps.db, request.locationId);
      if (replay) return { ok: true, value: replay, requestId: request.requestId };
    }
    return failure("CONFLICT", "The store profile update is still processing", request.requestId);
  }
  const current = await deps.db
    .prepare("SELECT version FROM fulfillment_location_delivery_profile WHERE location_id=?")
    .bind(request.locationId)
    .first<{ version: number }>();
  if ((current?.version ?? 0) !== request.expectedVersion) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure(
      "STALE_VERSION",
      "Store pickup profile changed; refresh first",
      request.requestId,
    );
  }
  const now = Date.now();
  try {
    const mutation = current
      ? deps.db
          .prepare(
            `UPDATE fulfillment_location_delivery_profile
             SET sender_name=?,phone_e164=?,email=?,formatted_address=?,address_line1=?,
                 address_line2=?,barangay=?,city=?,region=?,postal_code=?,country_code=?,
                 pickup_instructions=?,version=version+1,updated_at=?
             WHERE location_id=? AND version=?`,
          )
          .bind(
            normalized.senderName,
            normalized.phoneE164,
            normalized.email,
            normalized.formattedAddress,
            normalized.addressLine1,
            normalized.addressLine2,
            normalized.barangay,
            normalized.city,
            normalized.region,
            normalized.postalCode,
            normalized.countryCode,
            normalized.pickupInstructions,
            now,
            request.locationId,
            request.expectedVersion,
          )
      : deps.db
          .prepare(
            `INSERT INTO fulfillment_location_delivery_profile
             (location_id,sender_name,phone_e164,email,formatted_address,address_line1,
              address_line2,barangay,city,region,postal_code,country_code,pickup_instructions,
              version,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          )
          .bind(
            request.locationId,
            normalized.senderName,
            normalized.phoneE164,
            normalized.email,
            normalized.formattedAddress,
            normalized.addressLine1,
            normalized.addressLine2,
            normalized.barangay,
            normalized.city,
            normalized.region,
            normalized.postalCode,
            normalized.countryCode,
            normalized.pickupInstructions,
            now,
            now,
          );
    await deps.db.batch([
      mutation,
      deps.db.prepare("INSERT INTO admin_command_abort(id) SELECT 1 WHERE changes()=0"),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "DELIVERY.LOCATION_PROFILE_UPDATED",
        resourceType: "fulfillment_location_delivery_profile",
        resourceId: request.locationId,
        locationId: request.locationId,
        details: { expectedVersion: request.expectedVersion },
        idempotencyKey: request.idempotencyKey,
        correlationId: request.requestId,
        occurredAt: now,
      }),
      completeIdempotency(deps.db, scope, request.idempotencyKey, request.locationId, now),
    ]);
  } catch {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure("CONFLICT", "Store pickup profile could not be updated", request.requestId);
  }
  const saved = await loadProfile(deps.db, request.locationId);
  return saved
    ? { ok: true, value: saved, requestId: request.requestId }
    : failure("INTERNAL_ERROR", "Saved store pickup profile is unavailable", request.requestId);
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nestedObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") return parseObject(value);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function destinationComponents(snapshot: Record<string, unknown>): AddressComponents | null {
  const structured = nestedObject(snapshot.address_components_json);
  const legacy = nestedObject(snapshot.address_json);
  const source = structured ?? legacy;
  if (!source) return null;
  const addressLine1 = nullableString(source, "addressLine1") ?? nullableString(source, "line1");
  const city = nullableString(source, "city") ?? nullableString(snapshot, "city");
  if (!addressLine1 || !city) return null;
  return {
    addressLine1,
    addressLine2: nullableString(source, "addressLine2") ?? nullableString(source, "line2"),
    barangay: nullableString(source, "barangay") ?? nullableString(snapshot, "barangay"),
    city,
    region: nullableString(source, "region"),
    postalCode: nullableString(source, "postalCode") ?? nullableString(snapshot, "postal_code"),
    countryCode: (nullableString(source, "countryCode") ?? "PH").toUpperCase(),
  };
}

function deliveryInstructions(value: string | null): DeliveryInstructions | null {
  if (value === null) return EMPTY_INSTRUCTIONS;
  const parsed = parseObject(value);
  if (!parsed) return null;
  return {
    buildingUnit: nullableString(parsed, "buildingUnit"),
    landmark: nullableString(parsed, "landmark"),
    gateGuard: nullableString(parsed, "gateGuard"),
    deliveryNote: nullableString(parsed, "deliveryNote"),
    recipientInstruction: nullableString(parsed, "recipientInstruction"),
  };
}

function formattedDestination(components: AddressComponents): string {
  return [
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
}

function publicDispatch(value: ProviderDispatchView): ExternalDeliveryDispatchView {
  return {
    dispatchId: value.dispatchId,
    deliveryJobId: value.deliveryJobId,
    provider: value.provider as "lalamove" | "grab-express",
    providerDeliveryId: value.providerDeliveryId,
    status: value.status,
    providerStatus: value.providerStatus,
    trackingUrl: value.trackingUrl,
    pickupPin: value.pickupPin,
    quoteAmountMinor: value.quoteAmountMinor,
    quoteCurrency: value.quoteCurrency,
    attemptCount: value.attemptCount,
    lastErrorCode: value.lastErrorCode,
    version: value.version,
  };
}

export async function requestExternalDelivery(
  deps: OperationsAdministrationDeps & {
    provider: DeliveryProvider;
    configuredServiceType: string;
    now: () => number;
  },
  request: RequestExternalDeliveryRequest,
): Promise<RpcResult<ExternalDeliveryDispatchView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  if (deps.provider.code !== request.providerCode)
    return failure(
      "CONFIGURATION_ERROR",
      "Requested delivery provider is unavailable",
      request.requestId,
    );

  // Exact successful replay is resolved before consulting mutable job/profile
  // state. A completed booking stays replayable after later status changes.
  const commandScope = "admin.delivery.externalDispatch";
  const commandPayload = {
    locationId: request.locationId,
    jobId: request.jobId,
    expectedVersion: request.expectedVersion,
    providerCode: request.providerCode,
    pickup: request.pickup,
  };
  const hash = await requestHash(commandPayload);
  const prior = await deps.db
    .prepare(
      `SELECT request_hash,status FROM idempotency_records
       WHERE scope=? AND idempotency_key=?`,
    )
    .bind(commandScope, request.idempotencyKey)
    .first<{ request_hash: string; status: string }>();
  if (prior) {
    if (prior.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used for a different courier booking",
        request.requestId,
      );
    const existing = await deps.db
      .prepare(
        `SELECT id AS dispatchId,delivery_job_id AS deliveryJobId,provider,
                provider_delivery_id AS providerDeliveryId,status,
                provider_status AS providerStatus,tracking_url AS trackingUrl,
                pickup_pin AS pickupPin,quote_amount_minor AS quoteAmountMinor,
                quote_currency AS quoteCurrency,attempt_count AS attemptCount,
                last_error_code AS lastErrorCode,version
         FROM delivery_provider_dispatch WHERE client_idempotency_key=?`,
      )
      .bind(request.idempotencyKey)
      .first<ExternalDeliveryDispatchView>();
    if (prior.status === "SUCCEEDED" && existing)
      return { ok: true, value: existing, requestId: request.requestId };
    return failure(
      "CONFLICT",
      prior.status === "FAILED"
        ? "The previous courier booking failed; use a new request key after review"
        : "The courier booking is still processing",
      request.requestId,
    );
  }

  const row = await deps.db
    .prepare(
      `SELECT job.id AS job_id, job.order_id, job.version AS job_version,
              job.status AS job_status, job.fulfillment_mode, job.location_id,
              job.cycle_id, job.batch_id, job.rider_id, job.promised_at,
              snapshot.delivery_date, snapshot.delivery_execution_snapshot_json,
              orders.currency, orders.total_minor,
              stop.latitude, stop.longitude, stop.address_snapshot_json,
              stop.contact_snapshot_json, stop.instructions_snapshot,
              profile.sender_name, profile.phone_e164, profile.email,
              location.latitude AS origin_latitude, location.longitude AS origin_longitude,
              profile.formatted_address, profile.address_line1, profile.address_line2,
              profile.barangay, profile.city, profile.region, profile.postal_code,
              profile.country_code, profile.pickup_instructions
       FROM delivery_job job
       JOIN grocery_order orders ON orders.id=job.order_id
       JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id
       JOIN delivery_stop stop ON stop.delivery_job_id=job.id
       JOIN fulfillment_location location ON location.id=job.location_id AND location.status='active'
       LEFT JOIN fulfillment_location_delivery_profile profile ON profile.location_id=location.id
       WHERE job.id=? AND job.location_id=?`,
    )
    .bind(request.jobId, request.locationId)
    .first<DispatchSourceRow>();
  if (!row) return failure("NOT_FOUND", "Delivery job is unavailable", request.requestId);
  if (row.job_version !== request.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Delivery job changed; refresh before booking",
      request.requestId,
    );
  if (
    !["UNASSIGNED", "RETRY_SCHEDULED"].includes(row.job_status) ||
    row.batch_id !== null ||
    row.rider_id !== null
  )
    return failure(
      "ILLEGAL_TRANSITION",
      "Delivery job is not available for external booking",
      request.requestId,
    );
  if (
    !row.sender_name ||
    !row.phone_e164 ||
    !row.formatted_address ||
    !row.address_line1 ||
    !row.city ||
    !row.country_code
  )
    return failure(
      "CONFIGURATION_ERROR",
      "This store location needs a complete courier pickup profile",
      request.requestId,
    );

  const execution = parseObject(row.delivery_execution_snapshot_json);
  const serviceType =
    row.fulfillment_mode === "INSTANT"
      ? nullableString(execution, "providerServiceType")
      : deps.configuredServiceType;
  const selectedProvider = nullableString(execution, "providerCode");
  if (
    row.fulfillment_mode === "INSTANT" &&
    (nullableString(execution, "selectedBy") !== "CUSTOMER" ||
      nullableString(execution, "method") !== "EXTERNAL_PROVIDER" ||
      selectedProvider !== request.providerCode)
  )
    return failure(
      "CONFLICT",
      "Instant delivery must use the provider selected by the customer",
      request.requestId,
    );
  if (!serviceType)
    return failure(
      "CONFIGURATION_ERROR",
      "Delivery service type is unavailable",
      request.requestId,
    );

  const now = deps.now();
  const pickupAt = request.pickup.kind === "SCHEDULED" ? Date.parse(request.pickup.pickupAt) : null;
  const deliveryBoundary = row.fulfillment_mode === "INSTANT" ? row.promised_at : row.delivery_date;
  if (
    (pickupAt !== null && (!Number.isFinite(pickupAt) || pickupAt <= now)) ||
    (pickupAt !== null && deliveryBoundary !== null && pickupAt > deliveryBoundary) ||
    (request.pickup.kind === "IMMEDIATE" && deliveryBoundary !== null && now > deliveryBoundary)
  )
    return failure(
      "VALIDATION_FAILED",
      "Pickup must be in the future and no later than the committed delivery promise",
      request.requestId,
    );

  const address = parseObject(row.address_snapshot_json);
  const contact = parseObject(row.contact_snapshot_json);
  const destination = address ? destinationComponents(address) : null;
  const instructions = deliveryInstructions(row.instructions_snapshot);
  const recipientName = nullableString(contact, "recipient");
  const recipientPhone = nullableString(contact, "phone");
  if (
    !destination ||
    !instructions ||
    !recipientName ||
    !recipientPhone ||
    !/^\+[1-9]\d{7,14}$/.test(recipientPhone) ||
    row.latitude === null ||
    row.longitude === null
  )
    return failure(
      "VALIDATION_FAILED",
      "Customer delivery details are incomplete",
      request.requestId,
    );
  if (row.currency !== "PHP")
    return failure("CONFIGURATION_ERROR", "Lalamove PH requires a PHP order", request.requestId);

  const deliveryPackage = await resolveOrderDeliveryPackage(deps.db, row.order_id);
  if (!deliveryPackage.ok)
    return failure(
      "CONFIGURATION_ERROR",
      "Order shipping weight is unavailable",
      request.requestId,
    );
  const claim = await claimCommandIdempotency(
    deps.db,
    deps.now,
    commandScope,
    request.idempotencyKey,
    commandPayload,
  );
  if (!claim.claimed) {
    if (claim.existing?.requestHash !== claim.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used for a different courier booking",
        request.requestId,
      );
    if (claim.existing?.status !== "FAILED") {
      const existing = await deps.db
        .prepare(
          `SELECT id AS dispatchId,delivery_job_id AS deliveryJobId,provider,
                  provider_delivery_id AS providerDeliveryId,status,
                  provider_status AS providerStatus,tracking_url AS trackingUrl,
                  pickup_pin AS pickupPin,quote_amount_minor AS quoteAmountMinor,
                  quote_currency AS quoteCurrency,attempt_count AS attemptCount,
                  last_error_code AS lastErrorCode,version
           FROM delivery_provider_dispatch WHERE delivery_job_id=?`,
        )
        .bind(request.jobId)
        .first<ExternalDeliveryDispatchView>();
      if (claim.existing?.status === "SUCCEEDED" && existing)
        return { ok: true, value: existing, requestId: request.requestId };
      return failure("CONFLICT", "The courier booking is still processing", request.requestId);
    }
  }

  const providerResult = await requestProviderDelivery(deps.db, deps.provider, {
    requestId: request.requestId,
    deliveryJobId: request.jobId,
    expectedDeliveryJobVersion: request.expectedVersion,
    clientIdempotencyKey: request.idempotencyKey,
    request: {
      merchantOrderId: row.order_id,
      serviceType,
      currencyCode: row.currency,
      currencyExponent: 2,
      packages: [
        {
          kind: deliveryPackage.value.kind,
          name: "FreshMarkets grocery order",
          description: "FreshMarkets grocery order",
          quantity: 1,
          weightGrams: deliveryPackage.value.weightGrams,
          priceMinor: row.total_minor,
        },
      ],
      sender: {
        name: row.sender_name,
        phoneE164: row.phone_e164,
        email: row.email,
        smsEnabled: true,
      },
      recipient: {
        name: recipientName,
        phoneE164: recipientPhone,
        email: null,
        smsEnabled: true,
      },
      origin: {
        formattedAddress: row.formatted_address,
        coordinate: { latitude: row.origin_latitude, longitude: row.origin_longitude },
        components: {
          addressLine1: row.address_line1,
          addressLine2: row.address_line2,
          barangay: row.barangay,
          city: row.city,
          region: row.region,
          postalCode: row.postal_code,
          countryCode: row.country_code,
        },
        instructions: { ...EMPTY_INSTRUCTIONS, deliveryNote: row.pickup_instructions },
      },
      destination: {
        formattedAddress: formattedDestination(destination),
        coordinate: { latitude: row.latitude, longitude: row.longitude },
        components: destination,
        instructions,
      },
      schedule:
        pickupAt === null
          ? null
          : {
              pickupFrom: new Date(pickupAt).toISOString(),
              pickupTo: new Date(pickupAt + 30 * 60_000).toISOString(),
            },
    },
  });
  if (!providerResult.ok) {
    await failIdempotency(deps.db, commandScope, request.idempotencyKey);
    return failure("CONFLICT", providerResult.error.message, request.requestId);
  }
  const finishedAt = deps.now();
  await deps.db.batch([
    deps.db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(providerResult.value.dispatchId, finishedAt, commandScope, request.idempotencyKey),
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "DELIVERY.EXTERNAL_PROVIDER_REQUESTED",
      resourceType: "delivery_provider_dispatch",
      resourceId: providerResult.value.dispatchId,
      locationId: request.locationId,
      details: {
        jobId: request.jobId,
        providerCode: request.providerCode,
        pickupKind: request.pickup.kind,
      },
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestId,
      occurredAt: finishedAt,
    }),
  ]);
  return {
    ok: true,
    value: publicDispatch(providerResult.value),
    requestId: request.requestId,
  };
}

async function loadExternalDispatch(
  database: D1Database,
  dispatchId: string,
  locationId: string,
): Promise<(ExternalDeliveryDispatchView & { providerDeliveryId: string | null }) | null> {
  return database
    .prepare(
      `SELECT dispatch.id AS dispatchId,dispatch.delivery_job_id AS deliveryJobId,
              dispatch.provider,dispatch.provider_delivery_id AS providerDeliveryId,
              dispatch.status,dispatch.provider_status AS providerStatus,
              dispatch.tracking_url AS trackingUrl,dispatch.pickup_pin AS pickupPin,
              dispatch.quote_amount_minor AS quoteAmountMinor,
              dispatch.quote_currency AS quoteCurrency,dispatch.attempt_count AS attemptCount,
              dispatch.last_error_code AS lastErrorCode,dispatch.version
       FROM delivery_provider_dispatch dispatch
       JOIN delivery_job job ON job.id=dispatch.delivery_job_id
       WHERE dispatch.id=? AND job.location_id=?`,
    )
    .bind(dispatchId, locationId)
    .first<ExternalDeliveryDispatchView & { providerDeliveryId: string | null }>();
}

async function providerMutation(
  deps: OperationsAdministrationDeps & { provider: DeliveryProvider; now: () => number },
  request: RefreshExternalDeliveryRequest,
  operation: "REFRESH" | "CANCEL",
): Promise<RpcResult<ExternalDeliveryDispatchView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  const scope = `admin.delivery.external${operation === "REFRESH" ? "Refresh" : "Cancel"}`;
  const claim = await claimCommandIdempotency(deps.db, deps.now, scope, request.idempotencyKey, {
    locationId: request.locationId,
    dispatchId: request.dispatchId,
    expectedVersion: request.expectedVersion,
    ...(request.providerDeliveryId ? { providerDeliveryId: request.providerDeliveryId } : {}),
  });
  if (!claim.claimed) {
    if (claim.existing?.requestHash !== claim.hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", request.requestId);
    const replay = await loadExternalDispatch(deps.db, request.dispatchId, request.locationId);
    if (claim.existing?.status === "SUCCEEDED" && replay)
      return { ok: true, value: replay, requestId: request.requestId };
    return failure("CONFLICT", "The provider operation is still processing", request.requestId);
  }
  const current = await loadExternalDispatch(deps.db, request.dispatchId, request.locationId);
  if (!current) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure("NOT_FOUND", "External delivery was not found", request.requestId);
  }
  if (current.version !== request.expectedVersion) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure("STALE_VERSION", "External delivery changed; refresh first", request.requestId);
  }
  const providerDeliveryId = current.providerDeliveryId ?? request.providerDeliveryId;
  const recoveringIdentity = !current.providerDeliveryId;
  if (
    deps.provider.code !== current.provider ||
    (request.providerDeliveryId &&
      current.providerDeliveryId &&
      request.providerDeliveryId !== current.providerDeliveryId) ||
    !providerDeliveryId ||
    (recoveringIdentity &&
      (operation !== "REFRESH" ||
        !["CREATING", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(current.status)))
  ) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure("CONFLICT", "Provider delivery identity is unavailable", request.requestId);
  }
  const commandId = `delivery-command:${scope}:${request.idempotencyKey}`;
  let observationVersion = request.expectedVersion;
  if (operation === "CANCEL" && current.status !== "ACTIVE") {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure(
      "CONFLICT",
      "An uncertain or closed delivery cannot be canceled again; reconcile it first",
      request.requestId,
    );
  }
  const intentStatements: D1PreparedStatement[] = [
    deps.db
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -33 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch WHERE id=? AND version=?)",
      )
      .bind(request.dispatchId, request.expectedVersion),
  ];
  if (operation === "CANCEL") {
    intentStatements.push(
      deps.db
        .prepare(`UPDATE delivery_provider_dispatch SET status='OUTCOME_UNKNOWN',last_error_code='CANCEL_OUTCOME_UNKNOWN',version=version+1,updated_at=?
      WHERE id=? AND version=? AND status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM delivery_provider_command WHERE dispatch_id=? AND operation='CANCEL' AND status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED'))`)
        .bind(deps.now(), request.dispatchId, request.expectedVersion, request.dispatchId),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -33 WHERE changes()!=1"),
    );
    observationVersion += 1;
  }
  intentStatements.push(
    deps.db
      .prepare(`INSERT INTO delivery_provider_command
    (id,dispatch_id,operation,idempotency_scope,idempotency_key,request_hash,actor_user_id,location_id,request_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'SUBMITTING',?,?)
    ON CONFLICT(idempotency_scope,idempotency_key) DO UPDATE SET status='SUBMITTING',observation_id=NULL,updated_at=excluded.updated_at
      WHERE delivery_provider_command.status='REJECTED' AND delivery_provider_command.request_hash=excluded.request_hash`)
      .bind(
        commandId,
        request.dispatchId,
        operation,
        scope,
        request.idempotencyKey,
        claim.hash,
        access.value.authUserId,
        request.locationId,
        request.requestId,
        deps.now(),
        deps.now(),
      ),
    deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -33 WHERE changes()!=1"),
  );
  try {
    await deps.db.batch(intentStatements);
  } catch (error) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
      throw error;
    return failure(
      "STALE_VERSION",
      "Delivery changed before the provider operation",
      request.requestId,
    );
  }
  const reject = async (unknown: boolean) => {
    const statements = [
      deps.db
        .prepare(
          "UPDATE delivery_provider_command SET status=?,updated_at=? WHERE id=? AND status='SUBMITTING'",
        )
        .bind(unknown ? "OUTCOME_UNKNOWN" : "REJECTED", deps.now(), commandId),
    ];
    if (operation === "CANCEL" && !unknown)
      statements.push(
        deps.db
          .prepare(`UPDATE delivery_provider_dispatch
      SET status='ACTIVE',last_error_code='CANCEL_REJECTED',version=version+1,updated_at=? WHERE id=? AND version=? AND status='OUTCOME_UNKNOWN'`)
          .bind(deps.now(), request.dispatchId, observationVersion),
      );
    await deps.db.batch(statements);
    if (!unknown) await failIdempotency(deps.db, scope, request.idempotencyKey);
  };
  let observation: ProviderDelivery;
  if (operation === "CANCEL") {
    let canceled;
    try {
      canceled = await deps.provider.cancel(providerDeliveryId);
    } catch {
      await reject(true);
      return failure(
        "CONFLICT",
        "Provider cancellation outcome is unknown; refresh to reconcile",
        request.requestId,
      );
    }
    if (!canceled.ok) {
      await reject(canceled.error.outcomeUnknown);
      return failure("CONFLICT", "Provider cancellation was not confirmed", request.requestId);
    }
    observation = {
      providerDeliveryId,
      merchantOrderId: null,
      status: "CANCELED",
      trackingUrl: null,
      pickupPin: null,
      quote: null,
    };
  } else {
    let observed;
    try {
      observed = await deps.provider.get(providerDeliveryId);
    } catch {
      await reject(false);
      return failure("CONFLICT", "Provider delivery could not be refreshed", request.requestId);
    }
    if (!observed.ok || !observed.value) {
      await reject(false);
      return failure("CONFLICT", "Provider delivery could not be refreshed", request.requestId);
    }
    if (observed.value.providerDeliveryId !== providerDeliveryId) {
      await reject(false);
      return failure("CONFLICT", "Provider returned a different delivery", request.requestId);
    }
    if (recoveringIdentity) {
      const match = await deps.db
        .prepare("SELECT id FROM delivery_provider_dispatch WHERE id=? AND merchant_order_id=?")
        .bind(request.dispatchId, observed.value.merchantOrderId)
        .first();
      if (!observed.value.merchantOrderId || !match) {
        await reject(false);
        return failure(
          "CONFLICT",
          "Provider merchant reference does not match this booking",
          request.requestId,
        );
      }
    }
    observation = observed.value;
  }
  const alreadyCompleted = await deps.db
    .prepare("SELECT id FROM delivery_provider_command WHERE id=? AND status='SUCCEEDED'")
    .bind(commandId)
    .first();
  if (alreadyCompleted) {
    const completed = await loadExternalDispatch(deps.db, request.dispatchId, request.locationId);
    if (completed) return { ok: true, value: completed, requestId: request.requestId };
  }
  const now = deps.now();
  // Failed command retries must not attach new evidence to an older observation.
  const inboxId = `admin-delivery:${crypto.randomUUID()}`;
  const identityStatements: D1PreparedStatement[] = recoveringIdentity
    ? [
        deps.db
          .prepare(`UPDATE delivery_provider_dispatch SET provider_delivery_id=?,version=version+1,updated_at=?
      WHERE id=? AND version=? AND provider_delivery_id IS NULL AND status IN ('CREATING','OUTCOME_UNKNOWN','RECONCILIATION_REQUIRED')
        AND NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch WHERE provider=? AND provider_delivery_id=?)`)
          .bind(
            providerDeliveryId,
            now,
            request.dispatchId,
            request.expectedVersion,
            current.provider,
            providerDeliveryId,
          ),
        deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -33 WHERE changes()!=1"),
        deps.db
          .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=?
      WHERE scope='admin.delivery.externalDispatch' AND status IN ('PROCESSING','FAILED') AND idempotency_key=
        (SELECT client_idempotency_key FROM delivery_provider_dispatch WHERE id=?)`)
          .bind(request.dispatchId, now, request.dispatchId),
        deps.db
          .prepare(`INSERT INTO audit_event
      (id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,correlation_id,occurred_at)
      VALUES (?,?,'DELIVERY.EXTERNAL_PROVIDER_IDENTITY_RECOVERED','delivery_provider_dispatch',?, '{}',?,?,?,?)`)
          .bind(
            `delivery-identity:${request.dispatchId}`,
            access.value.authUserId,
            request.dispatchId,
            request.idempotencyKey,
            request.locationId,
            request.requestId,
            now,
          ),
      ]
    : [];
  if (recoveringIdentity) observationVersion += 1;
  try {
    await deps.db.batch([
      ...identityStatements,
      deps.db
        .prepare(`INSERT OR IGNORE INTO delivery_provider_event_inbox
    (id,provider,provider_event_id,dispatch_id,provider_delivery_id,merchant_order_id,observed_at,
     provider_status,payload_hash,raw_payload,processing_status,received_at)
    SELECT ?,provider,?,id,provider_delivery_id,merchant_order_id,?,?,?,?, 'RECEIVED',?
    FROM delivery_provider_dispatch WHERE id=?`)
        .bind(
          inboxId,
          inboxId,
          now,
          observation.status,
          await requestHash(observation),
          JSON.stringify(observation),
          now,
          request.dispatchId,
        ),
      deps.db
        .prepare(
          "UPDATE delivery_provider_command SET status='OBSERVED',observation_id=?,updated_at=? WHERE id=? AND status IN ('SUBMITTING','OUTCOME_UNKNOWN')",
        )
        .bind(inboxId, now, commandId),
    ]);
  } catch (error) {
    await reject(false);
    if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
      throw error;
    return failure(
      "STALE_VERSION",
      "Delivery identity changed during recovery; refresh first",
      request.requestId,
    );
  }
  const applied = await applyProviderObservation(
    deps.db,
    {
      dispatchId: request.dispatchId,
      status: observation.status,
      observedAt: now,
      trackingUrl: observation.trackingUrl,
      pickupPin: observation.pickupPin,
    },
    {
      inboxId,
      expectedVersion: observationVersion,
    },
  );
  if (applied.outcome === "RECONCILIATION_REQUIRED") {
    return failure(
      applied.reason === "DELIVERY_DISPATCH_STALE" ? "STALE_VERSION" : "CONFLICT",
      "Provider evidence requires delivery reconciliation",
      request.requestId,
    );
  }
  const saved = await loadExternalDispatch(deps.db, request.dispatchId, request.locationId);
  if (!saved)
    return failure("INTERNAL_ERROR", "External delivery persistence failed", request.requestId);
  return { ok: true, value: saved, requestId: request.requestId };
}

export function refreshExternalDelivery(
  deps: OperationsAdministrationDeps & { provider: DeliveryProvider; now: () => number },
  request: RefreshExternalDeliveryRequest,
) {
  return providerMutation(deps, request, "REFRESH");
}

export function cancelExternalDelivery(
  deps: OperationsAdministrationDeps & { provider: DeliveryProvider; now: () => number },
  request: ExternalDeliveryMutationRequest,
) {
  return providerMutation(deps, request, "CANCEL");
}
