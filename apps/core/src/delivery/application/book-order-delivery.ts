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
import { requestProviderDelivery, type ProviderDispatchView } from "./request-provider-delivery";
import type { DeliveryProvider } from "../ports/delivery-provider";
import { deliveryRetryReadySql } from "./delivery-retry-readiness";
import {
  dispatchUnavailableMessage,
  firstDispatchEligibility,
} from "../domain/dispatch-eligibility";

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
  order_status: string;
  fulfillment_status: string;
  latest_attempt_status: string | null;
  retry_ready: number;
  pending_cancel: number;
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
  deliveryInstructions: null,
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
  const canonical = nullableString(parsed, "deliveryInstructions");
  if (canonical) return { deliveryInstructions: canonical };
  const legacy = [
    nullableString(parsed, "buildingUnit"),
    nullableString(parsed, "landmark"),
    nullableString(parsed, "gateGuard"),
    nullableString(parsed, "deliveryNote"),
    nullableString(parsed, "recipientInstruction"),
  ].filter((item): item is string => Boolean(item));
  return { deliveryInstructions: [...new Set(legacy)].join("\n") || null };
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

/** Shared booking command. A null actor is reserved for the system-owned Instant first booking. */
export async function bookOrderDelivery(
  deps: OrderDeliveryBookingDependencies,
  request: RequestExternalDeliveryRequest,
  actorUserId: string | null,
): Promise<RpcResult<ExternalDeliveryDispatchView>> {
  const automaticInstant = actorUserId === null;
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
    const canResumeAutomatic =
      automaticInstant &&
      prior.status === "PROCESSING" &&
      (!existing || ["PENDING", "RETRY_REQUIRED"].includes(existing.status));
    if (!canResumeAutomatic)
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
              COALESCE((SELECT revision.promised_at FROM delivery_promise_revision revision WHERE revision.delivery_job_id=job.id ORDER BY revision.job_version DESC LIMIT 1),delivery_window.ends_at,snapshot.delivery_date) AS delivery_date, snapshot.delivery_execution_snapshot_json,
              orders.currency, orders.total_minor, orders.status AS order_status,
              fulfillment.status AS fulfillment_status,
              latest.status AS latest_attempt_status,
              EXISTS (SELECT 1 FROM delivery_job eligible_job WHERE eligible_job.id=job.id AND ${deliveryRetryReadySql.replaceAll("job.", "eligible_job.")}) AS retry_ready,
              EXISTS (SELECT 1 FROM delivery_provider_command command JOIN delivery_provider_dispatch attempt ON attempt.id=command.dispatch_id
                WHERE attempt.delivery_job_id=job.id AND command.operation='CANCEL' AND command.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED')) AS pending_cancel,
              stop.latitude, stop.longitude, stop.address_snapshot_json,
              stop.contact_snapshot_json, stop.instructions_snapshot,
              profile.sender_name, profile.phone_e164, profile.email,
              location.latitude AS origin_latitude, location.longitude AS origin_longitude,
              profile.formatted_address, profile.address_line1, profile.address_line2,
              profile.barangay, profile.city, profile.region, profile.postal_code,
              profile.country_code, profile.pickup_instructions
       FROM delivery_job job
       JOIN grocery_order orders ON orders.id=job.order_id
       JOIN fulfillment_record fulfillment ON fulfillment.order_id=orders.id AND fulfillment.location_id=job.location_id
       JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=orders.id
       LEFT JOIN order_delivery_window_snapshot delivery_window ON delivery_window.order_id=orders.id
       JOIN delivery_stop stop ON stop.delivery_job_id=job.id
       JOIN fulfillment_location location ON location.id=job.location_id
       LEFT JOIN fulfillment_location_delivery_profile profile ON profile.location_id=location.id
       LEFT JOIN delivery_provider_dispatch latest ON latest.id=(SELECT id FROM delivery_provider_dispatch WHERE delivery_job_id=job.id ORDER BY attempt_sequence DESC LIMIT 1)
       WHERE job.id=? AND job.location_id=?`,
    )
    .bind(request.jobId, request.locationId)
    .first<DispatchSourceRow>();
  if (!row) return failure("NOT_FOUND", "Delivery job is unavailable", request.requestId);
  const now = deps.now();
  if (automaticInstant) {
    const resumableAttempt =
      row.latest_attempt_status === null ||
      ["PENDING", "RETRY_REQUIRED"].includes(row.latest_attempt_status);
    if (
      row.fulfillment_mode !== "INSTANT" ||
      row.job_status !== "UNASSIGNED" ||
      !["FULFILLMENT_PENDING", "FULFILLMENT_READY"].includes(row.order_status) ||
      !["PACKING", "PACKED"].includes(row.fulfillment_status) ||
      !resumableAttempt ||
      Boolean(row.pending_cancel) ||
      row.promised_at === null ||
      row.promised_at <= now
    )
      return failure(
        "ILLEGAL_TRANSITION",
        "Automatic Instant booking is unavailable for the current delivery state",
        request.requestId,
      );
  } else {
    const eligibility = firstDispatchEligibility({
      canManage: true,
      jobStatus: row.job_status,
      orderStatus: row.order_status,
      fulfillmentStatus: row.fulfillment_status,
      pendingCancellation: Boolean(row.pending_cancel),
      latestAttempt:
        row.latest_attempt_status === null ? null : { status: row.latest_attempt_status },
      retryReady: Boolean(row.retry_ready),
      deliveryDeadline: row.fulfillment_mode === "INSTANT" ? row.promised_at : row.delivery_date,
      now,
    });
    if (!eligibility.eligible)
      return failure(
        "ILLEGAL_TRANSITION",
        dispatchUnavailableMessage(eligibility),
        request.requestId,
      );
  }
  if (row.job_version !== request.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Delivery job changed; refresh before booking",
      request.requestId,
    );
  const retry = !automaticInstant && row.job_status === "FAILED";
  if (
    retry &&
    !(await deps.db
      .prepare(`SELECT 1 FROM delivery_job job WHERE job.id=? AND ${deliveryRetryReadySql}`)
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

  if (row.fulfillment_mode === "INSTANT" && request.pickup.kind !== "IMMEDIATE")
    return failure(
      "VALIDATION_FAILED",
      "Instant courier pickup must be requested immediately after packing",
      request.requestId,
    );
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
  if (!(automaticInstant && prior?.status === "PROCESSING")) {
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
    automaticInstant,
    clientIdempotencyKey: request.idempotencyKey,
    now: deps.now,
    ...(actorUserId === null ? {} : { actorAuthUserId: actorUserId }),
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
            automatic: automaticInstant,
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
      merchantOrderId: automaticInstant ? `fm-auto-${request.jobId}` : `fm-${crypto.randomUUID()}`,
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
        instructions: { deliveryInstructions: row.pickup_instructions },
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
    const retained = automaticInstant
      ? await deps.db
          .prepare("SELECT status FROM delivery_provider_dispatch WHERE client_idempotency_key=?")
          .bind(request.idempotencyKey)
          .first<{ status: string }>()
      : null;
    if (
      !automaticInstant ||
      !retained ||
      !["PENDING", "RETRY_REQUIRED", "CREATING", "OUTCOME_UNKNOWN"].includes(retained.status)
    )
      await failIdempotency(deps.db, commandScope, request.idempotencyKey);
    return failure("CONFLICT", providerResult.error.message, request.requestId);
  }
  return {
    ok: true,
    value: publicDispatch(providerResult.value),
    requestId: request.requestId,
  };
}
