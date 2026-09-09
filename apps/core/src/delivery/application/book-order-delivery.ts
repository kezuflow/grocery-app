import type {
  AddressComponents,
  AppErrorCode,
  DeliveryInstructions,
  ExternalDeliveryDispatchView,
  RequestExternalDeliveryRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency, requestHash } from "../../idempotency";
import { resolveOrderDeliveryPackage } from "../../fulfillment/application/resolve-order-delivery-package";
import { scheduledDeliveryGoodsReadySql } from "../../fulfillment/application/scheduled-delivery-readiness";
import { requestProviderDelivery, type ProviderDispatchView } from "./request-provider-delivery";
import type { DeliveryProvider } from "../ports/delivery-provider";
import { preHandoverRetrySql } from "./pre-handover-retry";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}
async function failIdempotency(database: D1Database, scope: string, key: string) {
  await database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED',updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}
export type OrderDeliveryBookingDependencies = {
  db: D1Database;
  provider: DeliveryProvider;
  configuredServiceType: string;
  now: () => number;
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

/** Internal command shared by authorized staff booking and readiness-driven Instant booking. */
export async function bookOrderDelivery(
  deps: OrderDeliveryBookingDependencies,
  request: RequestExternalDeliveryRequest,
  actorUserId: string | null,
): Promise<RpcResult<ExternalDeliveryDispatchView>> {
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
    if (
      actorUserId !== null ||
      prior.status !== "PROCESSING" ||
      (existing && existing.status !== "PENDING")
    )
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
              COALESCE(delivery_window.ends_at,snapshot.delivery_date) AS delivery_date, snapshot.delivery_execution_snapshot_json,
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
       LEFT JOIN order_delivery_window_snapshot delivery_window ON delivery_window.order_id=orders.id
       JOIN delivery_stop stop ON stop.delivery_job_id=job.id
       JOIN fulfillment_location location ON location.id=job.location_id
       LEFT JOIN fulfillment_location_delivery_profile profile ON profile.location_id=location.id
       WHERE job.id=? AND job.location_id=?`,
    )
    .bind(request.jobId, request.locationId)
    .first<DispatchSourceRow>();
  if (!row) return failure("NOT_FOUND", "Delivery job is unavailable", request.requestId);
  if (actorUserId === null && row.fulfillment_mode !== "INSTANT")
    return failure(
      "ILLEGAL_TRANSITION",
      "Automatic booking is only available for Instant",
      request.requestId,
    );
  if (row.fulfillment_mode === "INSTANT") {
    const ready = await deps.db
      .prepare(`SELECT 1 FROM fulfillment_record f JOIN grocery_order o ON o.id=f.order_id
      WHERE o.id=? AND f.location_id=? AND f.status IN ('PACKING','PACKED')
        AND o.status IN ('FULFILLMENT_PENDING','FULFILLMENT_READY')`)
      .bind(row.order_id, row.location_id)
      .first();
    if (!ready)
      return failure(
        "ILLEGAL_TRANSITION",
        "Check all items and start final packing before booking",
        request.requestId,
      );
  }
  if (row.fulfillment_mode === "SCHEDULED") {
    const ready = await deps.db
      .prepare(`SELECT 1 FROM delivery_job job WHERE job.id=? AND ${scheduledDeliveryGoodsReadySql}
      AND (?='SCHEDULED' OR EXISTS (SELECT 1 FROM fulfillment_record WHERE order_id=job.order_id AND status='PACKED'))`)
      .bind(row.job_id, request.pickup.kind)
      .first();
    if (!ready)
      return failure(
        "ILLEGAL_TRANSITION",
        "Start preparation and check received goods before scheduling pickup; an immediate pickup requires packing to be complete",
        request.requestId,
      );
  }
  if (row.job_version !== request.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Delivery job changed; refresh before booking",
      request.requestId,
    );
  const retry = row.job_status === "FAILED" && actorUserId !== null;
  if (
    retry &&
    !(await deps.db
      .prepare(`SELECT 1 FROM delivery_job job WHERE job.id=? AND ${preHandoverRetrySql}`)
      .bind(row.job_id)
      .first())
  )
    return failure(
      "ILLEGAL_TRANSITION",
      "Resolve the previous attempt and confirm custody before retrying",
      request.requestId,
    );
  if (
    (!["UNASSIGNED", "RETRY_SCHEDULED"].includes(row.job_status) && !retry) ||
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
  if (!(actorUserId === null && prior?.status === "PROCESSING")) {
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
           FROM delivery_provider_dispatch WHERE client_idempotency_key=?`,
          )
          .bind(request.idempotencyKey)
          .first<ExternalDeliveryDispatchView>();
        if (claim.existing?.status === "SUCCEEDED" && existing)
          return { ok: true, value: existing, requestId: request.requestId };
        return failure("CONFLICT", "The courier booking is still processing", request.requestId);
      }
    }
  }
  const providerResult = await requestProviderDelivery(deps.db, deps.provider, {
    requestId: request.requestId,
    deliveryJobId: request.jobId,
    expectedDeliveryJobVersion: request.expectedVersion,
    retry,
    clientIdempotencyKey: request.idempotencyKey,
    now: deps.now,
    actorAuthUserId: actorUserId ?? undefined,
    completionStatements: [
      deps.db
        .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(
        SELECT id FROM delivery_provider_dispatch WHERE client_idempotency_key=?),updated_at=?
        WHERE scope=? AND idempotency_key=? AND status='PROCESSING'`)
        .bind(request.idempotencyKey, now, commandScope, request.idempotencyKey),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()<>1"),
      deps.db
        .prepare(`INSERT INTO audit_event
        (id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,correlation_id,occurred_at)
        SELECT 'booking-result:'||id,?,'DELIVERY.EXTERNAL_PROVIDER_REQUESTED','delivery_provider_dispatch',id,?,?,?,?,?
        FROM delivery_provider_dispatch WHERE client_idempotency_key=?`)
        .bind(
          actorUserId,
          JSON.stringify({
            jobId: request.jobId,
            providerCode: request.providerCode,
            pickupKind: request.pickup.kind,
          }),
          request.idempotencyKey,
          request.locationId,
          request.requestId,
          now,
          request.idempotencyKey,
        ),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()<>1"),
    ],
    request: {
      merchantOrderId:
        actorUserId === null ? `fm-auto-${request.jobId}` : `fm-${crypto.randomUUID()}`,
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
    // A competing automatic pass may observe the first pass submitting. Do not
    // turn that pass's durable command into a failed receipt.
    if (actorUserId !== null) await failIdempotency(deps.db, commandScope, request.idempotencyKey);
    return failure("CONFLICT", providerResult.error.message, request.requestId);
  }
  return {
    ok: true,
    value: publicDispatch(providerResult.value),
    requestId: request.requestId,
  };
}
